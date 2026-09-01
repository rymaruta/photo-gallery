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
    /** 横と判定するための比率（`lib/utils/swipe.ts` と同じ既定値） */
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

    const handleEnd = useCallback(() => {
        if (!isDraggingRef.current || !touchStartRef.current) {
            isDraggingRef.current = false;
            return;
        }

        const start = touchStartRef.current;
        const end = touchMoveRef.current || start;

        const deltaX = end.x - start.x;
        const deltaY = end.y - start.y;
        const deltaTime = end.time - start.time;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const velocity = distance / Math.max(deltaTime, 1);

        // 速度が閾値未満の場合は無視
        if (velocity < velocityThreshold) {
            isDraggingRef.current = false;
            return;
        }

        // **軸ごとに見る。**
        //
        // 距離を2次元（√(dx²+dy²)）で見て、方向を `absX > absY` だけで
        // 決めていたので、**斜めのスワイプが縦に倒れて「閉じる」に化けて**
        // いた。実測（threshold=50 の場合）:
        //   dx=-45 dy=48 → down（閉じる）  … 次の写真へ送ったつもり
        //   dx=-36 dy=37 → down（閉じる）  … 45°方向の実効しきい値は 35px
        // 自然な弧を描くスワイプは普通に斜めになるので、日常的に踏む。
        //
        // 同じリポジトリの `lib/utils/swipe.ts` は比率ガード
        // （`absX <= absY * ratio` なら横と見なさない）を持っていて、
        // コメントにも「縦優位のときに 0 を返すことで、縦スクロールを
        // 誤ってタブ切替と判定しない」と書いてある。**正しい形は既に
        // あったのに、こちらだけ持っていなかった。**
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (absX >= threshold && absX > absY * ratio) {
            if (deltaX > 0) {
                setSwipeDirection("right");
                onSwipeRight?.();
            } else {
                setSwipeDirection("left");
                onSwipeLeft?.();
            }
        } else if (absY >= verticalThreshold && absY > absX * ratio) {
            if (deltaY > 0) {
                setSwipeDirection("down");
                onSwipeDown?.();
            } else {
                setSwipeDirection("up");
                onSwipeUp?.();
            }
        }
        // どちらでもない（斜め・小さすぎる）ときは何もしない。
        // 迷ったら動かさない——誤爆の方が高くつく

        isDraggingRef.current = false;
    }, [onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, threshold, verticalThreshold, velocityThreshold, ratio]);

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
            // 水平スワイプが確定した場合のみ preventDefault
            // （縦スクロールや他のデフォルト動作を不必要にブロックしない）
            if (touchStartRef.current && touchMoveRef.current) {
                const dx = Math.abs(touchMoveRef.current.x - touchStartRef.current.x);
                const dy = Math.abs(touchMoveRef.current.y - touchStartRef.current.y);
                if (dx > dy && dx > threshold) {
                    e.preventDefault();
                }
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
