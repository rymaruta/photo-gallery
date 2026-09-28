/**
 * ストーリーの輪の色。`StoriesBar`（トップ・24時間で消える束）と
 * `HighlightsRow`（マイページ・ハイライト）が同じ輪を描く——2か所に
 * 書くと、片方だけ色を直したときに静かにずれる。
 */

/**
 * 未読リング＝真鍮の単色（`--color-accent`）。デザインシステム「黒塗りの真鍮」で
 * 「未見のストーリーの輪」は真鍮の役目（iOS と同じ）。以前は Instagram の
 * ブランドグラデーションだった。値は `globals.css` の `@theme` だけが持つ（ここに写さない）
 */
export const RING_UNSEEN = "var(--color-accent)";
/** 既読リング（`--color-outline`）。ハイライトは既読・未読を持たないのでこちら */
export const RING_SEEN = "var(--color-outline)";
