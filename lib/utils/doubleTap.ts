/**
 * 写真を2回叩いたときの決まり。**一覧のモーダル（`GalleryModal`）と写真ページの
 * 全画面（`PhotoViewer`）で同じ1つを使う**——iOS の `DoubleTapLike` と同じ約束。
 *
 * 1. **いいね済みなら解除しない。** 2回目は演出（ハート）だけにする
 *    ——うっかり2回叩いていいねが消えると、押した本人は気づけない
 * 2. **拡大しているときは、いいねではなく倍率を戻す。**
 *    拡大したまま迷子になる出口を潰さない（モーダルには拡大が無いので常に false）
 */

export type TapMark = { t: number; x: number; y: number };

/** 叩いた記録なし（写真を送ったら・2回目が成立したらここへ戻す） */
export const NO_TAP: TapMark = { t: 0, x: 0, y: 0 };

/** 2回目と言える間（ms） */
export const DOUBLE_TAP_MS = 350;

/**
 * 2回目のタップが「同じ場所」と言える距離（px）。**場所も見る**——時間だけだと、
 * 画面の端と端を 350ms 以内に叩いてもいいねになった
 */
export const DOUBLE_TAP_SLOP = 40;

/** `next` が `prev` に続く2回目か */
export function isDoubleTap(prev: TapMark, next: TapMark): boolean {
    if (prev.t <= 0) return false;
    return next.t - prev.t < DOUBLE_TAP_MS
        && Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_SLOP;
}

export type DoubleTapAction = "like" | "burstOnly" | "resetZoom";

/** 2回目が成立したときに何をするか */
export function doubleTapAction({ isZoomed, alreadyLiked }: { isZoomed: boolean; alreadyLiked: boolean }): DoubleTapAction {
    if (isZoomed) return "resetZoom";
    return alreadyLiked ? "burstOnly" : "like";
}
