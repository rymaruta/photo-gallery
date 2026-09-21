/**
 * 「タップ」と「なぞった」の見分け。
 *
 * `click` は指を離せば必ず発火するので、これが無いと**なぞったつもりが
 * タップとして扱われる**（ストーリーでは、長押しで止めたあと離した瞬間に
 * 次へ進んでいた）。
 *
 * **数を2か所に書かない。** ストーリーの閲覧（送り・一時停止）と
 * 下書きの文字の置き方が同じ判断をするので、しきい値はここ1つ。
 * ずれると、片方では「なぞった」がもう片方では「タップ」になる。
 */

/** これ以上動いたら「なぞった」。指は静止していても数 px 揺れる */
export const TAP_MOVE_TOLERANCE_PX = 12;
/** これ以上押し続けたら「長押し」 */
export const LONG_PRESS_MS = 350;

export type PressPoint = { t: number; x: number; y: number };

/** 押し始めの点から、なぞったと言えるだけ動いたか */
export function movedBeyondTap(from: PressPoint, x: number, y: number): boolean {
    return Math.hypot(x - from.x, y - from.y) > TAP_MOVE_TOLERANCE_PX;
}

/**
 * 短いタップだったか（長押し・指の移動があれば false）。
 * `from` が無い環境（ポインタ情報が取れない）では、従来どおり動かす。
 */
export function wasShortTap(from: PressPoint | null, x: number, y: number, now = Date.now()): boolean {
    if (!from) return true;
    if (now - from.t >= LONG_PRESS_MS) return false;
    return !movedBeyondTap(from, x, y);
}
