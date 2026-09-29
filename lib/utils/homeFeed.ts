import type { Photo } from "@/lib/data/photos";

/**
 * ホームの「おすすめ」の並び（iOS の `HomeFeed.arrange(.recommended)` と同じ規則）。
 *
 *   1. 運営が選んだ写真（`featured`）を先に
 *   2. 残りは**いいねの多い順**（持たない写真は 0）
 *   3. 同点は**新しい順**（押すたびに並びが変わって見えないように）
 *
 * **推薦の仕組みは無い。** 選ばれた写真といいねの数だけで並べる。
 * ⚠️ 本番は 2026-09-29 時点で featured 0枚・いいね全部 0 なので、並びは「新着」と
 * 同じになる（iOS も同じ）。選ばれた写真やいいねが増えると差が出る。
 */
type Rankable = Pick<Photo, "featured" | "likes" | "createdAt">;

export function recommendedOrder<T extends Rankable>(photos: readonly T[]): T[] {
    const time = (p: Rankable) => {
        const t = Date.parse(p.createdAt ?? "");
        return Number.isNaN(t) ? -Infinity : t;
    };
    const byPopular = (a: Rankable, b: Rankable) =>
        ((b.likes ?? 0) - (a.likes ?? 0)) || (time(b) - time(a));
    const sorted = [...photos].sort(byPopular);
    return [...sorted.filter((p) => p.featured === true), ...sorted.filter((p) => p.featured !== true)];
}
