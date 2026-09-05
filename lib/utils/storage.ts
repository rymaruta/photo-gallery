/** Safe localStorage helpers — all operations are no-ops when localStorage is unavailable. */

export function storageGet<T>(key: string): T | undefined {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * 保存する。**成否を返す。**
 *
 * `void` を返していた頃、呼び出し側は失敗を知りようがなかった——
 * `useFavorites` の引き継ぎは「ユーザーのキーへコピー → 共有キーを空に」を
 * 続けて呼んでおり、**コピー（大きい）だけが容量で落ちて、空にする側
 * （小さい）は通る**ので、未ログインで貯めたハートが消えていた。
 * 「消える前に、書けたことを確かめる」ためには戻り値が要る。
 *
 * @returns 書けたら true（プライベートモード・容量超過なら false）
 */
export function storageSet<T>(key: string, value: T): boolean {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        // Quota exceeded or private-browsing restriction — silently ignore.
        return false;
    }
}

export function storageRemove(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        // ignore
    }
}
