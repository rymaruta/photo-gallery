/**
 * **曲の情報を読む前でも、頭出しを取りこぼさない。**
 *
 * `src` を差し替えた直後（`readyState` が `HAVE_NOTHING`）に `currentTime` を
 * 書くと、WebKit（iOS Safari）はその値を捨てることがあり、指定した
 * 「好きな部分」ではなく**曲の頭（0秒）から鳴る**。例外を握りつぶして
 * いたので、画面には何も出なかった（`docs/ios-bug-audit-2026-09-25.md` #36）。
 *
 * 読めているならその場で合わせる。まだなら今も試し、曲の情報が届いた時点
 * （`loadedmetadata`）でもう一度合わせる。その前に別の曲へ差し替わったら、
 * 古い頭出しは当てない（`src` を見て捨てる）。
 */
export function seekWhenReady(a: HTMLMediaElement, sec: number): void {
    const HAVE_METADATA = 1;
    try { a.currentTime = sec; } catch { /* seek 未対応は無視 */ }
    if (a.readyState >= HAVE_METADATA) return;
    // **`currentSrc` は見ない。** `src` を書き換えた直後は、`currentSrc` が
    // まだ前の曲を指している（Chromium で実測）。それを控えると、新しい曲の
    // 情報が届いた時点で「別の曲」と読んで頭出しを捨てる
    const src = a.src;
    a.addEventListener("loadedmetadata", () => {
        if (a.src !== src) return;
        try { a.currentTime = sec; } catch { /* seek 未対応は無視 */ }
    }, { once: true });
}
