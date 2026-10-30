import type { Photo } from "@/lib/data/photos";
import { comparePosted } from "./photoOrder";

/**
 * ホームの「おすすめ」の並び（iOS の `HomeFeed.arrange(.recommended)` と同じ規則）。
 *
 *   1. 運営が選んだ写真（`featured === true`）を先に
 *   2. 残りは**いいねの多い順**（持たない写真は 0）
 *   3. 同点は**投稿の新しい順**（`comparePosted`＝`createdAt` をゾーンの表記を落として文字列で比べ、無ければ
 *      撮影日 `date`、どちらも無いものは末尾、同じなら id）
 *
 * **推薦の仕組みは無い。** 選ばれた写真といいねの数だけで並べる。
 * ⚠️ 本番（2026-09-29: featured 0枚・いいね全部 0）では「投稿の新しい順」になる。
 * ホームの「新着」も投稿日の新しい順なので、そのときは新着と同じ並びになる
 * （2026-10-30 に新着を `compareNewest`＝撮影日が先 から `comparePosted` へ揃えた。iOS も同じ）。
 */
export function recommendedOrder<T extends Photo>(photos: readonly T[]): T[] {
    const byPopular = (a: T, b: T) => ((b.likes ?? 0) - (a.likes ?? 0)) || comparePosted(a, b);
    const sorted = [...photos].sort(byPopular);
    return [...sorted.filter((p) => p.featured === true), ...sorted.filter((p) => p.featured !== true)];
}
