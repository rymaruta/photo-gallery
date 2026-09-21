/**
 * タブの矢印キー操作（WAI-ARIA の tabs の作法）。
 *
 * **`SpotPageClient` と `NotificationsBell` が同じ計算を各自で書いていた。**
 * どちらも「矢印で隣へ・端で折り返す・Home/End で端へ」で、違うのは
 * 選び方（`setTab`）とフォーカスを送る先の id だけ。**その2つは
 * 呼び出し側に残し、計算だけをここへ寄せる**——片方だけ直して
 * もう片方が取り残される、という形を作らない。
 *
 * 副作用は持たない（`preventDefault` もフォーカスもここではやらない）。
 * 純関数なので、端の折り返しを単体で確かめられる。
 */

/** 矢印キーが動かす先。押されたのがタブの操作でなければ `null` */
export function nextTabIndex(key: string, current: number, count: number): number | null {
    // **数が0以下なら何もしない。** `% 0` は NaN、`count - 1` は -1 になり、
    // どちらも「存在しないタブ」を指す添字が返る
    if (count <= 0) return null;
    // 範囲の外から呼ばれたら（選択中のタブが一覧から消えた直後など）
    // 先頭から数え直す。負の添字を `%` に通すと負が残る
    const at = current >= 0 && current < count ? current : 0;
    switch (key) {
        case "ArrowRight": return (at + 1) % count;
        case "ArrowLeft": return (at - 1 + count) % count;
        case "Home": return 0;
        case "End": return count - 1;
        default: return null;
    }
}
