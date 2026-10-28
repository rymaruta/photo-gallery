/**
 * 地図の撮影スポットのピンの写真（サムネ）の場所。**画面側で組む。**
 *
 * スポットは約2,500件あり、`/map` のページ本体（HTML と `.txt`・どちらも `no-store`）に
 * 全件が載る。パスを1件ずつ送ると gzip で約12KB 重くなった（2026-10-28 のレビューで実測）。
 * サムネは決まった場所（`/images/spots/thumb/<slug>.jpg`・`lib/data/spotThumbs.ts`）に
 * 作るので、ほとんどは「在る」の印（`true`）だけ送り、形の違う行だけパスを送る。
 *
 * **台帳（`lib/data/spotLink.ts`）から import しない**——あちらは台帳の本体を読むので、
 * 画面のチャンクに全文が載る。ここは画面から読むので、値を何も読まない。
 */
export const SPOT_THUMB_BASE = "/images/spots/thumb/";

export function spotPinThumbSrc(spot: { slug: string; thumb?: true | string }): string | undefined {
    if (spot.thumb === true) return `${SPOT_THUMB_BASE}${spot.slug}.jpg`;
    return typeof spot.thumb === "string" && spot.thumb ? spot.thumb : undefined;
}
