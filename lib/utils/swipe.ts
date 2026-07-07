// スワイプ判定のための純粋関数群（UI から切り離してテスト可能にする）

/**
 * ポインタ移動量から横スワイプの方向を判定する。
 *  1  = 左へスワイプ（＝次へ）
 * -1  = 右へスワイプ（＝前へ）
 *  0  = スワイプとみなさない（移動が小さい／縦方向優位）
 *
 * 縦優位のときに 0 を返すことで、縦スクロールを誤ってタブ切替と判定しない。
 */
export function swipeDirection(dx: number, dy: number, threshold = 45, ratio = 1.4): -1 | 0 | 1 {
    if (Math.abs(dx) < threshold) return 0;
    if (Math.abs(dx) <= Math.abs(dy) * ratio) return 0;
    return dx < 0 ? 1 : -1;
}

/** 配列内で current から dir 分だけ動いた次の要素（両端はクランプ、ラップしない） */
export function stepInList<T>(list: readonly T[], current: T, dir: number): T {
    const i = list.indexOf(current);
    if (i < 0) return current;
    return list[Math.min(list.length - 1, Math.max(0, i + dir))];
}
