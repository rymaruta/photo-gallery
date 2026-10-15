/**
 * ストーリーの輪の色。`StoriesBar`（トップ・24時間で消える束）と
 * `HighlightsRow`（マイページ・ハイライト）が同じ輪を描く——2か所に
 * 書くと、片方だけ色を直したときに静かにずれる。
 */

/**
 * 未読リング＝**真鍮の金属の光**（2026-10-15・iOS v2 の `WebTheme.accentMetal`・板の `.ring`）。
 * 暗い端 → 明るい端 → 真鍮 → 暗い端 を円周に回す（`conic-gradient(from 210deg, …)`）。
 * v1 は真鍮の単色（`--color-accent`）、その前は Instagram のブランドグラデーションだった。
 * 光の両端は輪・メダル・Pro の印だけに使う色で、字には使わない。
 * 値は `globals.css` の `@theme` だけが持つ（ここに写さない）
 */
export const RING_UNSEEN =
    "conic-gradient(from 210deg, var(--color-accent-lo), var(--color-accent-hi), var(--color-accent), var(--color-accent-lo))";
/** 既読リング（`--color-outline`）。ハイライトは既読・未読を持たないのでこちら */
export const RING_SEEN = "var(--color-outline)";
