/**
 * カバーの候補（#304・板 50 CoverPick・2026-10-18）。プロフィールの編集で、自分の投稿から4枚を並べる。
 *
 * - 並べ方は「いいねの多い順」（同じ数なら新しい順）と「最近」（投稿の新しい順）の2つ
 * - **出すのは全体に公開している自分の写真だけ**（カバーは誰にでも見えるので、下書き・非公開・
 *   公開範囲を絞った写真・ストーリーは出さない）。条件はサーバーの `isPublicListPhoto`（`api-user/src/feed.ts`）と同じ
 * - いいねの数は候補の下に出さない（競う数にしない・板の付箋）——ここは並べるだけ
 *
 * iOS の `CoverCandidates`（`Sources/JourneyPhoto/Features/Profile/CoverCandidates.swift`）と同じ決まり
 */
export type CoverSort = "likes" | "recent";

export type CoverCandidateRow = {
    id: string;
    src?: string;
    thumbSrc?: string;
    published?: boolean;
    story?: boolean;
    audience?: unknown;
    likes?: number;
    createdAt?: string;
};

/** 候補の数（板 50: 4枚） */
export const COVER_CANDIDATES = 4;

export function isCoverCandidate(p: CoverCandidateRow): boolean {
    if (!p.src) return false;
    if (p.published === false) return false;
    if (p.story === true) return false;
    const a = p.audience;
    if (typeof a === "string" ? a.trim() !== "" : a != null) return false;
    return true;
}

const likesOf = (p: CoverCandidateRow) => (typeof p.likes === "number" && p.likes > 0 ? p.likes : 0);
const timeOf = (p: CoverCandidateRow) => {
    const t = typeof p.createdAt === "string" ? Date.parse(p.createdAt) : NaN;
    return Number.isFinite(t) ? t : 0;
};

export function coverCandidates<T extends CoverCandidateRow>(photos: readonly T[], sort: CoverSort, limit = COVER_CANDIDATES): T[] {
    const list = photos.filter(isCoverCandidate);
    list.sort((a, b) => (sort === "likes" ? likesOf(b) - likesOf(a) : 0) || timeOf(b) - timeOf(a) || a.id.localeCompare(b.id));
    return list.slice(0, limit);
}
