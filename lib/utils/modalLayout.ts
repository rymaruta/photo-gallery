/**
 * ギャラリーモーダルの高さの下限（TAP-7）。
 *
 * **下限は「固定 px」で書いてはいけない。** 画像 300px とキャプション 200px の
 * 固定下限は合計 500px で、外枠（スマホ縦は `h-full`、それ以外は `95vh`）が
 * それより低い**横向きのスマホでは必ず溢れる**。どちらも `flex-shrink-0` なので
 * 縮まず、キャプションの箱ごと画面の外へ出る——中を最後までスクロールしても
 * 共有ボタンの行に指が届かない。実測（修正前）:
 *
 *     667x375  最後の行が画面外に 118px
 *     568x320  同 169px
 *     844x390  同 104px
 *
 * 画面の高さに連動させれば、低い画面では両方が自動的に小さくなる。
 * 縦向き（667px 以上）では `min()` が固定値を選ぶので**見た目は変わらない**。
 */
export const IMAGE_MIN_HEIGHT = "min(300px, 45vh)";
export const CAPTION_MIN_HEIGHT = "min(200px, 30vh)";

/** 画面の高さ（px）に対して、実際に効く下限を解く */
export function resolvedMinHeights(viewportHeight: number): { image: number; caption: number } {
    return {
        image: Math.min(300, viewportHeight * 0.45),
        caption: Math.min(200, viewportHeight * 0.30),
    };
}

/**
 * その画面の高さで、下限の合計が外枠に収まるか。
 *
 * 外枠は `sm:max-h-[95vh]`（横向きのスマホは幅 640px 以上なのでこちら）。
 * スマホ縦は `h-full`（＝100vh）なのでもっと余裕がある。
 */
export function minHeightsFitViewport(viewportHeight: number, frameRatio = 0.95): boolean {
    const m = resolvedMinHeights(viewportHeight);
    return m.image + m.caption <= viewportHeight * frameRatio;
}
