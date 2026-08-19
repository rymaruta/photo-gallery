// ストーリーBGMの「好きな部分」を選ぶバーの計算。
//
// <input type="range"> を透明で重ねる作りだと、iOS Safari では
// 見えないつまみ（約20px）を掴まないと動かず「反応しない」ことがある。
// そのためバー全体をポインタで直接扱う。ここはその純粋な計算部分。

/**
 * バー上のポインタ位置から、再生範囲の開始秒を求める。
 * 押した位置が範囲の「中央」になるように置き、端では自然に止まる。
 *
 * @param clientX ポインタの X 座標
 * @param left    バーの左端の X 座標
 * @param width   バーの幅（px）
 * @param windowSec 範囲の長さ（秒）
 * @param totalSec  バー全体の長さ（秒）
 */
export function startFromPointer(
    clientX: number,
    left: number,
    width: number,
    windowSec: number,
    totalSec: number,
): number {
    if (!(width > 0) || !Number.isFinite(clientX)) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
    const center = ratio * totalSec;
    return clampStart(center - windowSec / 2, windowSec, totalSec);
}

/** 開始秒を 0〜(全体-範囲) に収め、整数秒に丸める */
export function clampStart(start: number, windowSec: number, totalSec: number): number {
    const max = Math.max(0, totalSec - windowSec);
    if (!Number.isFinite(start)) return 0;
    return Math.round(Math.min(max, Math.max(0, start)));
}
