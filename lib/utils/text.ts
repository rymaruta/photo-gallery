/**
 * 長さで切る。書記素（見た目の1文字）の途中では切らない。
 * 予算はコードユニット数（画面の `maxLength` と同じ数え方）。
 * 3ファイルに同じものを置いてある（`scripts/__tests__/truncateCopies.test.ts`）。
 */
export function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    let cut = s.slice(0, max);
    const seg = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
    if (seg) {
        let end = 0;
        for (const g of seg.segment(s)) {
            const next = g.index + g.segment.length;
            if (next > max) break;
            end = next;
        }
        // 先頭の1つが予算より大きいと end が 0 になる（長い ZWJ 連結など）。
        // そこで空にすると**本文が丸ごと消える**——化けるより悪いので、
        // そのときだけ今までどおりコードユニットで切る
        if (end > 0) cut = s.slice(0, end);
    }
    const last = cut.charCodeAt(cut.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * 孤立サロゲート（ペアの片割れ）を落とす。
 *
 * `encodeURIComponent` はこれを見ると `URIError` で投げる。URL に載る値
 * （slug・共有テキスト）に混ざると、その場で例外になる——静的ビルドなら
 * **ビルドごと止まる**。切り詰め側（`truncate`）は入口を塞いだが、
 * **既に保存されている値には効かない**ので、URL を組む側でも落とす。
 *
 * ルックビハインドを使わない書き方にしてある。正当なペアを先に食わせて
 * そのまま返し、残った片割れだけを捨てる（Safari 16.3 以前でも動く）。
 */
export function stripLoneSurrogates(s: string): string {
    return s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
        (m) => (m.length === 2 ? m : ""));
}
