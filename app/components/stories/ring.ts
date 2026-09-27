/**
 * ストーリーの輪の色。`StoriesBar`（トップ・24時間で消える束）と
 * `HighlightsRow`（マイページ・ハイライト）が同じ輪を描く——2か所に
 * 書くと、片方だけ色を直したときに静かにずれる。
 */

/**
 * 未読リング＝真鍮の単色（`--color-accent`）。デザインシステム「黒塗りの真鍮」で
 * 「未見のストーリーの輪」は真鍮の役目（iOS と同じ）。以前は Instagram の
 * ブランドグラデーションだった
 */
export const RING_UNSEEN = "#c9a66b";
/** 既読リング（`--color-outline`）。ハイライトは既読・未読を持たないのでこちら */
export const RING_SEEN = "#666666";
