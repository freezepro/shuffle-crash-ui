import { apiUrl } from "./apiBase";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const key = (name: string) => `crash:last-known:v1:${apiUrl("/")}:${name}`;

export function readLastKnown<T>(name: string, decode: (value: unknown) => T | null): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(name));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!Number.isFinite(entry.savedAt) || entry.savedAt > Date.now() + 60000
      || Date.now() - entry.savedAt > MAX_AGE_MS) return null;
    return decode(entry.value);
  } catch {
    return null;
  }
}

export function saveLastKnown(name: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(name), JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Storage may be disabled or full; live delivery must continue.
  }
}
