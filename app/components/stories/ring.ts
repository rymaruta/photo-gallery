/**
 * ストーリーの輪の色。`StoriesBar`（トップ・24時間で消える束）と
 * `HighlightsRow`（マイページ・ハイライト）が同じ輪を描く——2か所に
 * 書くと、片方だけ色を直したときに静かにずれる。
 */

/** 未読リング（Instagram のブランドグラデーション） */
export const RING_UNSEEN = "linear-gradient(45deg, #FEDA75, #FA7E1E, #D62976, #962FBF, #4F5BD5)";
/** 既読リング（上品なグレー）。ハイライトは既読・未読を持たないのでこちら */
export const RING_SEEN = "#3a3a3d";
