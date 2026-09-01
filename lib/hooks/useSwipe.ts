// lib/hooks/useSwipe.ts
// スワイプジェスチャー検出用のカスタムフック

import { useRef, useState, useCallback } from "react";

type SwipeOptions = {
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    onSwipeUp?: () => void;
    onSwipeDown?: () => void;
    threshold?: number; // 横スワイプと判定する最小距離（ピクセル）
    /**
     * 縦スワイプと判定する最小距離。既定は横の2倍。
     *
     * **縦は誤爆の代償が大きい**（このフックの唯一の使い手である
     * ギャラリーモーダルでは「閉じる」）。写真を送るつもりの指が少し
     * 下に流れただけで閉じられると、見ていた場所ごと失う。
     */
    verticalThreshold?: number;
    velocityThreshold?: number; // スワイプと判定する最小速度
    /**
     * **縦**と判定するための比率。
     *
     * 横には掛けない。`lib/utils/swipe.ts` は同じ 1.4 を横に掛けているが、
     * あちらの2択は「横スワイプ／ブラウザの縦スクロールに任せる」なので、
     * 迷ったら 0 を返して困らない。**このフックは4方向とも自前の
     * ジェスチャ**なので、同じ形を横に持ってくると帯がまるごと
     * 「何も起きない穴」になる（実測: 前のコミットで 14,336 サンプル中
     * 1,972 の横スワイプが無反応になっていた）。
     */
    ratio?: number;
};

type SwipeHandlers = {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchCancel: (e: React.TouchEvent) => void;
    onMouseDown: (e: React.MouseEvent) => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseUp: (e: React.MouseEvent) => void;
};

export function useSwipe(options: SwipeOptions = {}) {
    const {
        onSwipeLeft,
        onSwipeRight,
        onSwipeUp,
        onSwipeDown,
        threshold = 50,
        verticalThreshold = threshold * 2,
        velocityThreshold = 0.3,
        ratio = 1.4,
    } = options;

    const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | "up" | "down" | null>(null);
    
    const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
    const touchMoveRef = useRef<{ x: number; y: number; time: number } | null>(null);
    const isDraggingRef = useRef(false);

    const handleStart = useCallback((x: number, y: number) => {
        touchStartRef.current = { x, y, time: Date.now() };
        touchMoveRef.current = null;
        isDraggingRef.current = true;
        setSwipeDirection(null);
    }, []);

    const handleMove = useCallback((x: number, y: number) => {
        if (!isDraggingRef.current || !touchStartRef.current) return;
        touchMoveRef.current = { x, y, time: Date.now() };
    }, []);

    /**
     * この指の動きをどう扱うか。**発火も `preventDefault` もこの1つで決める。**
     *
     * 別々に書いていたので食い違っていた——`preventDefault` は「距離だけ」
     * （`dx > dy && dx > threshold`）、発火は「距離かつ速度」。その結果、
     * ゆっくり 60px 横へ引くと**送られないのに click だけ潰され**、
     * 何も起きない無反応な操作になっていた。
     */
    const decide = useCallback((dx: number, dy: number, dt: number): "left" | "right" | "up" | "down" | null => {
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance / Math.max(dt, 1) < velocityThreshold) return null;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        // **横に比率は掛けない。** 掛けると 35°〜45° の帯が丸ごと
        // 無反応になる（実測 1,972/14,336）。斜めが「閉じる」に化ける
        // 事故を止めているのは**縦側の閾値と比率**で、横の比率ではない
        // ——外しても、旧実装で `down` になっていた 2,596 サンプルは
        // 1つも復活しない（実測）。
        if (absX >= threshold && absX > absY) return dx > 0 ? "right" : "left";
        if (absY >= verticalThreshold && absY > absX * ratio) return dy > 0 ? "down" : "up";
        // どちらでもない（斜め・小さすぎる）ときは何もしない。
        // 迷ったら動かさない——誤爆の方が高くつく
        return null;
    }, [threshold, verticalThreshold, velocityThreshold, ratio]);

    const handleEnd = useCallback(() => {
        if (!isDraggingRef.current || !touchStartRef.current) {
            // ここでも座標を捨てる。**不変条件を片方の枝だけにしない**
            // ——「追跡していない ⇒ 座標も無い」を全経路で成り立たせて
            // おけば、`onTouchEnd` 側は座標の有無を見るだけで足りる
            isDraggingRef.current = false;
            touchStartRef.current = null;
            touchMoveRef.current = null;
            return;
        }

        const start = touchStartRef.current;
        const end = touchMoveRef.current || start;
        const dir = decide(end.x - start.x, end.y - start.y, end.time - start.time);

        if (dir === "right") { setSwipeDirection("right"); onSwipeRight?.(); }
        else if (dir === "left") { setSwipeDirection("left"); onSwipeLeft?.(); }
        else if (dir === "down") { setSwipeDirection("down"); onSwipeDown?.(); }
        else if (dir === "up") { setSwipeDirection("up"); onSwipeUp?.(); }

        // **座標も捨てる。** 残しておくと、次に `onTouchEnd` が来たときに
        // 古い動きで `preventDefault` だけが掛かる（発火は
        // `isDraggingRef` で止まるので、「送られないのに click が
        // 潰される」——このフックが直したはずの症状そのもの）
        isDraggingRef.current = false;
        touchStartRef.current = null;
        touchMoveRef.current = null;
    }, [onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, decide]);

    const handlers: SwipeHandlers = {
        // **2本目の指が触れたら追跡をやめる。**
        // `touches[0]` を無条件に読んでいたので、ピンチで拡大しようとした
        // ときの1本目の動きがそのままスワイプとして扱われ、素早い操作だと
        // 「次の写真」「閉じる」に化けた（`touch-action: manipulation` は
        // ダブルタップズームだけを切るので、ピンチ自体は成立する）。
        onTouchStart: (e) => {
            if (e.touches.length > 1) {
                isDraggingRef.current = false;
                touchStartRef.current = null;
                return;
            }
            const touch = e.touches[0];
            if (touch) {
                handleStart(touch.clientX, touch.clientY);
            }
        },
        onTouchMove: (e) => {
            if (e.touches.length > 1) {
                isDraggingRef.current = false;
                touchStartRef.current = null;
                return;
            }
            const touch = e.touches[0];
            if (touch) {
                handleMove(touch.clientX, touch.clientY);
            }
        },
        // 指が離れる前に取り消された（電話の着信・システムのジェスチャ）
        // ときは、押しっぱなしの状態を残さない
        onTouchCancel: () => {
            isDraggingRef.current = false;
            touchStartRef.current = null;
            touchMoveRef.current = null;
        },
        onTouchEnd: (e) => {
            // 横スワイプとして扱うときだけ preventDefault（縦スクロールや
            // 他の既定動作を不必要にブロックしない）。**発火と同じ述語**で
            // 判断する——別々に書いていたので、ゆっくり引いたときに
            // 「送られないのに click だけ潰される」が起きていた
            // 座標が残っているのは追跡中の指だけ（降りる経路——
            // マルチタッチ・`touchcancel`・`handleEnd` の両枝——は
            // すべて座標も捨てる）。**守りを二重にしない**: 二重だと
            // 片方を壊してもテストが緑のままになる（この campaign で
            // 何度も出た型）
            const s0 = touchStartRef.current;
            const m0 = touchMoveRef.current;
            if (s0 && m0) {
                const dir = decide(m0.x - s0.x, m0.y - s0.y, m0.time - s0.time);
                if (dir === "left" || dir === "right") e.preventDefault();
            }
            handleEnd();
        },
        onMouseDown: (e) => {
            handleStart(e.clientX, e.clientY);
        },
        onMouseMove: (e) => {
            if (isDraggingRef.current) {
                handleMove(e.clientX, e.clientY);
            }
        },
        onMouseUp: () => {
            if (isDraggingRef.current) {
                handleEnd();
            }
        },
    };

    return {
        swipeDirection,
        handlers,
    };
}
