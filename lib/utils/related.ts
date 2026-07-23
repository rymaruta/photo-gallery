import type { Photo } from "../data/photos";

// 写真ページの回遊導線に使う「関連写真」の選定ロジック。
// ビルド時の photos.json（+ APIの最新一覧）だけで計算でき、API追加は不要。

/** 場所名を緩く正規化して比較する（前後空白・大文字小文字・全角空白を無視） */
function normalizeLocation(loc?: string): string {
    return (loc ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/** 2つの場所名が「同じ場所」とみなせるか（完全一致 or 一方が他方を含む） */
export function sameLocation(a?: string, b?: string): boolean {
    const na = normalizeLocation(a);
    const nb = normalizeLocation(b);
    if (na.length < 2 || nb.length < 2) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
}

/** createdAt/date の新しい順で安定ソートするための比較キー */
function timeKey(p: Photo): string {
    return (p.createdAt ?? p.date ?? "");
}

function sortByNewest(a: Photo, b: Photo): number {
    return timeKey(b).localeCompare(timeKey(a));
}

/** 公開写真だけに絞る（published===false を除外） */
function isPublic(p: Photo): boolean {
    return p.published !== false && !!p.src;
}

/**
 * 同じ投稿者の他の写真（新しい順）。current自身は除く。
 */
export function sameAuthorPhotos(current: Photo, all: Photo[], limit = 8): Photo[] {
    const owner = current.userId;
    if (!owner) return [];
    return all
        .filter((p) => p.id !== current.id && isPublic(p) && p.userId === owner)
        .sort(sortByNewest)
        .slice(0, limit);
}

/**
 * 同じ場所の写真（新しい順）。current自身と、同一投稿者の写真は除く
 * （「同じ投稿者」列と重複させないため）。
 */
export function sameLocationPhotos(current: Photo, all: Photo[], limit = 8): Photo[] {
    const loc = current.location;
    if (!loc || normalizeLocation(loc).length < 2) return [];
    return all
        .filter(
            (p) =>
                p.id !== current.id &&
                isPublic(p) &&
                p.userId !== current.userId &&
                sameLocation(p.location, loc),
        )
        .sort(sortByNewest)
        .slice(0, limit);
}

/**
 * 一覧の並び（新しい順）における前後の写真。
 * ホームの既定ソートと同じ「新しい順」で隣接するものを返す。
 * 端はループしない（先頭のprev/末尾のnextはnull）。
 */
export function adjacentPhotos(
    current: Photo,
    all: Photo[],
): { prev: Photo | null; next: Photo | null } {
    const ordered = all.filter(isPublic).sort(sortByNewest);
    const idx = ordered.findIndex((p) => p.id === current.id);
    if (idx === -1) return { prev: null, next: null };
    return {
        prev: idx > 0 ? ordered[idx - 1] : null,
        next: idx < ordered.length - 1 ? ordered[idx + 1] : null,
    };
}
