/** Recent share contacts for this browser (D-113). Survives reload; no API/schema change. */

const STORAGE_KEY = "notetaker.shareContacts";

export type ShareContact = {
  user_id: string;
  login: string;
};

function readRaw(): ShareContact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is ShareContact =>
          Boolean(x) &&
          typeof x === "object" &&
          typeof (x as ShareContact).user_id === "string" &&
          typeof (x as ShareContact).login === "string",
      )
      .map((x) => ({ user_id: x.user_id, login: x.login }));
  } catch {
    return [];
  }
}

function writeAll(list: ShareContact[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode — ignore */
  }
}

/** Remember a contact after a successful share (idempotent by user_id). */
export function rememberShareContact(contact: ShareContact): void {
  const login = contact.login.trim();
  if (!contact.user_id || !login) return;
  const prev = readRaw().filter((c) => c.user_id !== contact.user_id);
  writeAll([{ user_id: contact.user_id, login }, ...prev].slice(0, 40));
}

/** Merge several members into the remembered list (e.g. after loading a note). */
export function rememberShareContacts(contacts: ShareContact[]): void {
  for (const c of contacts) rememberShareContact(c);
}

export function listShareContacts(): ShareContact[] {
  return readRaw();
}

/** Initials for avatar circle (1–2 chars from login). */
export function contactInitials(login: string): string {
  const s = login.trim();
  if (!s) return "?";
  const parts = s.split(/[.\-_@\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return s.slice(0, 2).toUpperCase();
}
