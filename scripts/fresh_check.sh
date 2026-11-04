#!/usr/bin/env bash
# Isolated smoke: clone HEAD into a temp dir, bring up compose as project
# notetaker-fresh on alternate host ports, assert empty DB + basic API, then
# tear down ONLY that project (down -v). Never touches the developer's main stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${FRESH_PROJECT_NAME:-notetaker-fresh}"
API_PORT="${FRESH_API_PORT:-18000}"
WEB_PORT="${FRESH_WEB_PORT:-15173}"
POSTGRES_PORT="${FRESH_POSTGRES_PORT:-15432}"
MAILHOG_SMTP_PORT="${FRESH_MAILHOG_SMTP_PORT:-11025}"
MAILHOG_UI_PORT="${FRESH_MAILHOG_UI_PORT:-18025}"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/notetaker-fresh.XXXXXX")"
REPO="$TMP/repo"
CLEANED=0

cleanup() {
  if [[ "$CLEANED" -eq 1 ]]; then
    return
  fi
  CLEANED=1
  if [[ -d "$REPO" ]]; then
    echo "=== fresh-check: docker compose -p $PROJECT down -v ==="
    (cd "$REPO" && docker compose -p "$PROJECT" down -v --remove-orphans) || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "=== fresh-check: root=$ROOT tmp=$TMP project=$PROJECT ports api=$API_PORT web=$WEB_PORT pg=$POSTGRES_PORT mailhog=$MAILHOG_UI_PORT ==="

HEAD_SHA="$(cd "$ROOT" && git rev-parse HEAD)"
echo "=== fresh-check: cloning $HEAD_SHA ==="
git clone --local --no-hardlinks "$ROOT" "$REPO"
cd "$REPO"
git checkout -q "$HEAD_SHA"

cp .env.example .env
{
  echo ""
  echo "COMPOSE_PROJECT_NAME=$PROJECT"
  echo "API_PORT=$API_PORT"
  echo "WEB_PORT=$WEB_PORT"
  echo "POSTGRES_PORT=$POSTGRES_PORT"
  echo "MAILHOG_SMTP_PORT=$MAILHOG_SMTP_PORT"
  echo "MAILHOG_UI_PORT=$MAILHOG_UI_PORT"
  echo "AI_PROVIDER=stub"
} >> .env

echo "=== fresh-check: docker compose -p $PROJECT up --build -d ==="
docker compose -p "$PROJECT" --env-file .env up --build -d

echo "=== fresh-check: waiting for http://127.0.0.1:${API_PORT}/api/health (worker ok) ==="
ok=0
for _ in $(seq 1 90); do
  body="$(curl -sf "http://127.0.0.1:${API_PORT}/api/health" || true)"
  if echo "$body" | grep -q '"status":"ok"' && echo "$body" | grep -q '"ok":true'; then
    ok=1
    break
  fi
  sleep 2
done
if [[ "$ok" != "1" ]]; then
  echo "fresh-check FAILED: api/worker not healthy"
  curl -s "http://127.0.0.1:${API_PORT}/api/health" || true
  docker compose -p "$PROJECT" ps || true
  exit 1
fi
echo "health: $(curl -s "http://127.0.0.1:${API_PORT}/api/health")"

echo "=== fresh-check: notes count must be 0 on fresh volume ==="
NOTES="$(docker compose -p "$PROJECT" exec -T postgres \
  psql -U notetaker -d notetaker -tAc 'SELECT count(*) FROM notes;')"
NOTES="$(echo "$NOTES" | tr -d '[:space:]')"
echo "notes=$NOTES"
if [[ "$NOTES" != "0" ]]; then
  echo "fresh-check FAILED: expected 0 notes on isolated DB, got $NOTES (wrong volume?)"
  exit 1
fi

echo "=== fresh-check: MailHog UI ==="
mh="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${MAILHOG_UI_PORT}/")"
echo "mailhog HTTP $mh"
if [[ "$mh" != "200" ]]; then
  echo "fresh-check FAILED: MailHog UI not reachable on $MAILHOG_UI_PORT"
  exit 1
fi

LOGIN="fresh$(date +%s)"
PASS="fresh-check-pass"
EMAIL="${LOGIN}@example.com"

echo "=== fresh-check: register $LOGIN ==="
REG="$(curl -sS -c "$TMP/cookies.txt" -H 'Content-Type: application/json' \
  -d "{\"login\":\"$LOGIN\",\"password\":\"$PASS\",\"timezone\":\"UTC\"}" \
  "http://127.0.0.1:${API_PORT}/api/auth/register")"
echo "$REG" | head -c 240; echo
echo "$REG" | grep -q '"login"' || { echo "fresh-check FAILED: register"; exit 1; }

# Email is set via /api/me (register has no email field) so the worker can SMTP.
ME="$(curl -sS -b "$TMP/cookies.txt" -X PATCH -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\"}" \
  "http://127.0.0.1:${API_PORT}/api/me")"
echo "$ME" | grep -q "$EMAIL" || { echo "fresh-check FAILED: patch email"; echo "$ME"; exit 1; }

if STARTS="$(date -u -v+2H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"; then
  :
else
  STARTS="$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)"
fi
echo "=== fresh-check: create note starts_at=$STARTS ==="
NOTE="$(curl -sS -b "$TMP/cookies.txt" -H 'Content-Type: application/json' \
  -d "{\"title\":\"fresh-check\",\"body\":\"isolated\",\"starts_at\":\"$STARTS\",\"reminder_offsets\":[10],\"tag_ids\":[]}" \
  "http://127.0.0.1:${API_PORT}/api/notes")"
echo "$NOTE" | head -c 300; echo
echo "$NOTE" | grep -q '"id"' || { echo "fresh-check FAILED: create note"; exit 1; }
NOTE_ID="$(echo "$NOTE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"

NOTES2="$(docker compose -p "$PROJECT" exec -T postgres \
  psql -U notetaker -d notetaker -tAc 'SELECT count(*) FROM notes;')"
NOTES2="$(echo "$NOTES2" | tr -d '[:space:]')"
echo "notes after create=$NOTES2"
if [[ "$NOTES2" != "1" ]]; then
  echo "fresh-check FAILED: expected 1 note, got $NOTES2"
  exit 1
fi

# Force due so worker sends without waiting ~2h (same volume/project isolation still checked).
echo "=== fresh-check: force reminder due + wait MailHog for $EMAIL ==="
docker compose -p "$PROJECT" exec -T postgres \
  psql -U notetaker -d notetaker -v ON_ERROR_STOP=1 \
  -c "UPDATE reminders SET fire_at = now() - interval '1 second' WHERE note_id = '$NOTE_ID' AND status = 'pending';" \
  >/dev/null
mail_ok=0
for _ in $(seq 1 45); do
  mh_json="$(curl -sf "http://127.0.0.1:${MAILHOG_UI_PORT}/api/v2/messages" || true)"
  if echo "$mh_json" | grep -q "$EMAIL"; then
    mail_ok=1
    break
  fi
  sleep 1
done
if [[ "$mail_ok" != "1" ]]; then
  echo "fresh-check FAILED: no MailHog message to $EMAIL within timeout"
  curl -s "http://127.0.0.1:${MAILHOG_UI_PORT}/api/v2/messages" | head -c 500; echo
  exit 1
fi
echo "mailhog: message for $EMAIL present"

# Informational: main stack on default ports should still have its own (usually non-zero) count.
if curl -sf "http://127.0.0.1:8000/api/health" >/dev/null 2>&1; then
  MAIN_NOTES="$(cd "$ROOT" && docker compose exec -T postgres \
    psql -U notetaker -d notetaker -tAc 'SELECT count(*) FROM notes;' 2>/dev/null || echo unknown)"
  MAIN_NOTES="$(echo "$MAIN_NOTES" | tr -d '[:space:]')"
  echo "main stack notes (informational)=$MAIN_NOTES ; fresh=$NOTES2"
  if [[ "$MAIN_NOTES" != "unknown" && "$MAIN_NOTES" == "$NOTES2" && "$MAIN_NOTES" == "1" ]]; then
    echo "fresh-check WARNING: main and fresh both show 1 — verify you did not share volumes"
  fi
fi

echo "=== fresh-check: OK ==="
