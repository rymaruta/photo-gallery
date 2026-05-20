/** Safe localStorage helpers — all operations are no-ops when localStorage is unavailable. */

export function storageGet<T>(key: string): T | undefined {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
        return undefined;
    }
}

export function storageSet<T>(key: string, value: T): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Quota exceeded or private-browsing restriction — silently ignore.
    }
}

export function storageRemove(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        // ignore
    }
}
