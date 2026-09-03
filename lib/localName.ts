const STORAGE_KEY = "wedding-guest-name";

export function getStoredName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // localStorage unavailable (private mode, disabled) — not critical, just skip persisting
  }
}
