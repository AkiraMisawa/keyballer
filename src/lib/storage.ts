// localStorage that never throws (private windows, blocked storage).

export function load(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** localStorage itself, or nothing where the browser blocks it (reading the property can throw). */
export function browserStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

export function save(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Not saved; the app still works for this visit.
  }
}
