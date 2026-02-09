// lib/hooks/useSwipe.ts
// スワイプジェスチャー検出用のカスタムフック

import { useRef, useState, useCallback } from "react";

type SwipeOptions = {
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    onSwipeUp?: () => void;
    onSwipeDown?: () => void;
    threshold?: number; // スワイプと判定する最小距離（ピクセル）
    velocityThreshold?: number; // スワイプと判定する最小速度
};

type SwipeHandlers = {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
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
        velocityThreshold = 0.3,
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

        // 距離が閾値未満の場合は無視
        if (distance < threshold) {
            isDraggingRef.current = false;
            return;
        }

        // 方向を判定（より大きな移動方向を優先）
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (absX > absY) {
            // 横方向のスワイプ
            if (deltaX > 0) {
                setSwipeDirection("right");
                onSwipeRight?.();
            } else {
                setSwipeDirection("left");
                onSwipeLeft?.();
            }
        } else {
            // 縦方向のスワイプ
            if (deltaY > 0) {
                setSwipeDirection("down");
                onSwipeDown?.();
            } else {
                setSwipeDirection("up");
                onSwipeUp?.();
            }
        }

        isDraggingRef.current = false;
    }, [onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, threshold, velocityThreshold]);

    const handlers: SwipeHandlers = {
        onTouchStart: (e) => {
            const touch = e.touches[0];
            if (touch) {
                handleStart(touch.clientX, touch.clientY);
            }
        },
        onTouchMove: (e) => {
            const touch = e.touches[0];
            if (touch) {
                handleMove(touch.clientX, touch.clientY);
            }
        },
        onTouchEnd: (e) => {
            e.preventDefault();
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
        onMouseUp: (_e) => {
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
