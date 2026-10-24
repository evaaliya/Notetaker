#!/usr/bin/env python3
"""Seed demo user + N notes (default 10000).

Usage:
  docker compose exec api python scripts/seed.py --notes 10000
  make seed
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.migrate import run_migrations
from app.models import User
from app.services.seed import count_user_notes, ensure_demo_user, seed_notes_for_user


async def _run(notes: int, login: str, password: str, email: str, replace: bool) -> None:
    run_migrations()
    async with SessionLocal() as session:
        async with session.begin():
            user = await ensure_demo_user(
                session, login=login, password=password, email=email
            )
            existing = await count_user_notes(session, user.id)
            if existing >= notes and not replace:
                print(
                    f"user {login!r} already has {existing} notes "
                    f"(>= {notes}); skip. Use --replace to wipe and reseed."
                )
                return
            if replace and existing:
                # Cascade deletes notes/tags links via FK; keep user + re-seed tags.
                from sqlalchemy import delete

                from app.models import Note

                await session.execute(delete(Note).where(Note.user_id == user.id))
                print(f"deleted {existing} existing notes for {login!r}")
            need = notes if replace or existing == 0 else max(0, notes - existing)
            if need == 0:
                print(f"nothing to insert (have {existing})")
                return
            n = await seed_notes_for_user(session, user.id, count=need)
            total = await count_user_notes(session, user.id)
            print(f"inserted {n} notes; user {login!r} / {password!r}; total={total}")
            # confirm login exists
            found = (
                await session.execute(select(User).where(User.login == login))
            ).scalar_one()
            print(f"email={found.email!r} timezone={found.timezone!r}")


def main() -> None:
    p = argparse.ArgumentParser(description="Seed demo user and notes")
    p.add_argument("--notes", type=int, default=10000)
    p.add_argument("--login", default="demo")
    p.add_argument("--password", default="demo")
    p.add_argument("--email", default="demo@example.com")
    p.add_argument(
        "--replace",
        action="store_true",
        help="delete existing notes for the user and insert --notes anew",
    )
    args = p.parse_args()
    try:
        asyncio.run(
            _run(args.notes, args.login, args.password, args.email, args.replace)
        )
    except Exception as exc:  # noqa: BLE001 — CLI surface
        print(f"seed failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
