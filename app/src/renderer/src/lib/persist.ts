// Small UI state that should survive a restart (the open page, the Send list, an unsaved sync job…) lives in
// the window's local storage, which Electron keeps in the data folder. Reads and writes never throw: a
// private window or a full disk only means the state is not remembered.

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not remembered */
  }
}
