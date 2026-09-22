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

/**
 * 縦スワイプの方向。
 *  1  = 下へスワイプ（＝閉じる）
 * -1  = 上へスワイプ（＝メニューを出す）
 *  0  = スワイプとみなさない（移動が小さい／横方向優位）
 *
 * 横優位のときに 0 を返すことで、**前後のストーリーへの送りと取り合わない**
 * （ストーリー閲覧のモック⑤: 左右で前後、上下でメニュー・閉じる）。
 * しきい値が横（45px）より大きいのは、**閉じるのは戻れない操作**だから
 * ——指の揺れで閉じると、見ていた場所に戻すのは手間が大きい。
 */
export function verticalSwipeDirection(dx: number, dy: number, threshold = 70, ratio = 1.4): -1 | 0 | 1 {
    if (Math.abs(dy) < threshold) return 0;
    if (Math.abs(dy) <= Math.abs(dx) * ratio) return 0;
    return dy > 0 ? 1 : -1;
}

/** 配列内で current から dir 分だけ動いた次の要素（両端はクランプ、ラップしない） */
export function stepInList<T>(list: readonly T[], current: T, dir: number): T {
    const i = list.indexOf(current);
    if (i < 0) return current;
    return list[Math.min(list.length - 1, Math.max(0, i + dir))];
}
