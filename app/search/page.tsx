import GalleryPageClient from "../GalleryPageClient";

/**
 * 写真をさがす。
 *
 * **いまはトップと同じものを出している。** owner の新デザインでは
 * トップが1列のカードフィードになり、絞り込みと一覧はこちらが持ち場に
 * なる（`docs/redesign-2026-09.md` の ④）。**それまでの間だけ重なる**ので
 * `noindex`（レイアウト側）にしてある——同じ中身が2つの URL で索引に
 * 入るのを避けるため。
 *
 * 構造化データは置かない（索引に入れないページなので機械向けの申告は要らない）。
 */
export default function SearchPage() {
    return <GalleryPageClient />;
}
