import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSwipe } from "../useSwipe";
import type React from "react";

function makeMouseEvent(x: number, y: number): React.MouseEvent {
    return { clientX: x, clientY: y } as React.MouseEvent;
}

describe("useSwipe", () => {
    describe("マウスイベントによるスワイプ検出", () => {
        it("左スワイプ: onSwipeLeft が呼ばれる", () => {
            const onLeft = vi.fn();
            const { result } = renderHook(() => useSwipe({ onSwipeLeft: onLeft, threshold: 50, velocityThreshold: 0 }));
            act(() => {
                result.current.handlers.onMouseDown(makeMouseEvent(200, 100));
                result.current.handlers.onMouseMove(makeMouseEvent(100, 100));
                result.current.handlers.onMouseUp(makeMouseEvent(100, 100));
            });
            expect(onLeft).toHaveBeenCalledOnce();
        });

        it("右スワイプ: onSwipeRight が呼ばれる", () => {
            const onRight = vi.fn();
            const { result } = renderHook(() => useSwipe({ onSwipeRight: onRight, threshold: 50, velocityThreshold: 0 }));
            act(() => {
                result.current.handlers.onMouseDown(makeMouseEvent(100, 100));
                result.current.handlers.onMouseMove(makeMouseEvent(200, 100));
                result.current.handlers.onMouseUp(makeMouseEvent(200, 100));
            });
            expect(onRight).toHaveBeenCalledOnce();
        });

        it("上スワイプ: onSwipeUp が呼ばれる", () => {
            const onUp = vi.fn();
            const { result } = renderHook(() => useSwipe({ onSwipeUp: onUp, threshold: 50, velocityThreshold: 0 }));
            act(() => {
                result.current.handlers.onMouseDown(makeMouseEvent(100, 200));
                result.current.handlers.onMouseMove(makeMouseEvent(100, 100));
                result.current.handlers.onMouseUp(makeMouseEvent(100, 100));
            });
            expect(onUp).toHaveBeenCalledOnce();
        });

        it("下スワイプ: onSwipeDown が呼ばれる", () => {
            const onDown = vi.fn();
            const { result } = renderHook(() => useSwipe({ onSwipeDown: onDown, threshold: 50, velocityThreshold: 0 }));
            act(() => {
                result.current.handlers.onMouseDown(makeMouseEvent(100, 100));
                result.current.handlers.onMouseMove(makeMouseEvent(100, 200));
                result.current.handlers.onMouseUp(makeMouseEvent(100, 200));
            });
            expect(onDown).toHaveBeenCalledOnce();
        });
    });

    describe("閾値（threshold）チェック", () => {
        it("移動距離が threshold 未満ならコールバックを呼ばない", () => {
            const onLeft = vi.fn();
            const { result } = renderHook(() => useSwipe({ onSwipeLeft: onLeft, threshold: 100, velocityThreshold: 0 }));
            act(() => {
                result.current.handlers.onMouseDown(makeMouseEvent(200, 100));
                result.current.handlers.onMouseMove(makeMouseEvent(160, 100)); // 40px < 100
                result.current.handlers.onMouseUp(makeMouseEvent(160, 100));
            });
            expect(onLeft).not.toHaveBeenCalled();
        });

        it("移動なし（onMouseMove なし）はコールバックを呼ばない", () => {
            const onLeft = vi.fn();
            const { result } = renderHook(() => useSwipe({ onSwipeLeft: onLeft, threshold: 10, velocityThreshold: 0 }));
            act(() => {
                result.current.handlers.onMouseDown(makeMouseEvent(200, 100));
                result.current.handlers.onMouseUp(makeMouseEvent(200, 100));
            });
            expect(onLeft).not.toHaveBeenCalled();
        });
    });

    describe("横スワイプ優先ルール", () => {
        it("X 移動 > Y 移動の場合は横スワイプと判定する", () => {
            const onLeft = vi.fn();
            const onUp = vi.fn();
            const { result } = renderHook(() =>
                useSwipe({ onSwipeLeft: onLeft, onSwipeUp: onUp, threshold: 20, velocityThreshold: 0 })
            );
            // deltaX=80, deltaY=30 → 横スワイプ
            act(() => {
                result.current.handlers.onMouseDown(makeMouseEvent(200, 100));
                result.current.handlers.onMouseMove(makeMouseEvent(120, 70));
                result.current.handlers.onMouseUp(makeMouseEvent(120, 70));
            });
            expect(onLeft).toHaveBeenCalledOnce();
            expect(onUp).not.toHaveBeenCalled();
        });
    });

    describe("swipeDirection 状態", () => {
        it("スワイプ後に swipeDirection が更新される", () => {
            const { result } = renderHook(() => useSwipe({ threshold: 50, velocityThreshold: 0 }));
            act(() => {
                result.current.handlers.onMouseDown(makeMouseEvent(200, 100));
                result.current.handlers.onMouseMove(makeMouseEvent(100, 100));
                result.current.handlers.onMouseUp(makeMouseEvent(100, 100));
            });
            expect(result.current.swipeDirection).toBe("left");
        });

        it("次のスワイプ開始時に swipeDirection がリセットされる", () => {
            const { result } = renderHook(() => useSwipe({ threshold: 50, velocityThreshold: 0 }));
            act(() => {
                result.current.handlers.onMouseDown(makeMouseEvent(200, 100));
                result.current.handlers.onMouseMove(makeMouseEvent(100, 100));
                result.current.handlers.onMouseUp(makeMouseEvent(100, 100));
            });
            act(() => {
                result.current.handlers.onMouseDown(makeMouseEvent(100, 100));
            });
            expect(result.current.swipeDirection).toBeNull();
        });
    });
});
