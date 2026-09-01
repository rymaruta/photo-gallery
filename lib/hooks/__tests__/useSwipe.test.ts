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

// **斜めのスワイプが「閉じる」に化けていた。**
//
// 距離を2次元（√(dx²+dy²)）で見て、方向を `absX > absY` だけで決めて
// いたので、自然な弧を描く横スワイプ（少し下に流れる）が縦と判定された。
// ギャラリーモーダルでは縦下＝`onClose` なので、**次の写真へ送ったつもりが
// モーダルごと閉じて、見ていた場所を失う**。
describe("斜めのスワイプ", () => {
    function swipe(dx: number, dy: number, opts: Parameters<typeof useSwipe>[0] = {}) {
        const calls: string[] = [];
        const { result } = renderHook(() => useSwipe({
            onSwipeLeft: () => calls.push("left"),
            onSwipeRight: () => calls.push("right"),
            onSwipeUp: () => calls.push("up"),
            onSwipeDown: () => calls.push("down"),
            ...opts,
        }));
        act(() => {
            result.current.handlers.onMouseDown({ clientX: 200, clientY: 200 } as React.MouseEvent);
            result.current.handlers.onMouseMove({ clientX: 200 + dx, clientY: 200 + dy } as React.MouseEvent);
            result.current.handlers.onMouseUp({} as React.MouseEvent);
        });
        return calls;
    }

    it("横が優位でなければ、どちらにも倒さない（閉じない）", () => {
        // 実測で `down`（＝閉じる）になっていた組み合わせ
        expect(swipe(-45, 48), "斜めのスワイプで閉じている").toEqual([]);
        expect(swipe(-36, 37)).toEqual([]);
        expect(swipe(-50, 50)).toEqual([]);
    });

    // **比率で見る（`absX > absY` だけでは足りない）。**
    // dx=-60 / dy=50 は「横の方が大きい」が、指はほぼ斜め45°に近い。
    // ここで送ってしまうと、閉じるつもりの下スワイプが横に化ける側の
    // 誤爆も同じだけ起きる。`lib/utils/swipe.ts` と同じ 1.4 倍を使う
    it("横がわずかに大きいだけでは送らない（比率で見る）", () => {
        expect(swipe(-60, 50), "比率を見ずに横と判定している").toEqual([]);
        expect(swipe(-75, 50), "十分に横なのに送っていない").toEqual(["left"]);
    });

    it("横が明確なら今までどおり送る", () => {
        expect(swipe(-60, 20)).toEqual(["left"]);
        expect(swipe(80, 10)).toEqual(["right"]);
    });

    // 縦は誤爆の代償が大きい（モーダルでは「閉じる」）ので、横より深くする
    it("縦は横の2倍動かさないと成立しない", () => {
        expect(swipe(10, 60), "浅い下スワイプで閉じている").toEqual([]);
        expect(swipe(10, 120)).toEqual(["down"]);
        expect(swipe(10, -120)).toEqual(["up"]);
    });

    it("しきい値は呼び出し側で変えられる", () => {
        expect(swipe(10, 60, { verticalThreshold: 50 })).toEqual(["down"]);
    });
});

// **2本目の指が触れたら追跡をやめる。** ピンチで拡大しようとしたときの
// 1本目の動きが、そのままスワイプとして扱われていた。
describe("マルチタッチ", () => {
    function touchSwipe(points: { x: number; y: number }[], secondFinger: boolean) {
        const calls: string[] = [];
        const { result } = renderHook(() => useSwipe({
            onSwipeLeft: () => calls.push("left"),
            onSwipeDown: () => calls.push("down"),
        }));
        const touch = (x: number, y: number, count: number) => ({
            touches: Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
            preventDefault: () => { },
        } as unknown as React.TouchEvent);
        act(() => {
            result.current.handlers.onTouchStart(touch(points[0].x, points[0].y, 1));
            result.current.handlers.onTouchMove(touch(points[1].x, points[1].y, secondFinger ? 2 : 1));
            result.current.handlers.onTouchEnd(touch(points[1].x, points[1].y, 0));
        });
        return calls;
    }

    it("2本指なら送らない（ピンチを誤判定しない）", () => {
        expect(touchSwipe([{ x: 200, y: 200 }, { x: 120, y: 210 }], true),
            "ピンチが横スワイプに化けている").toEqual([]);
    });

    it("1本指なら今までどおり送る", () => {
        expect(touchSwipe([{ x: 200, y: 200 }, { x: 120, y: 210 }], false)).toEqual(["left"]);
    });

    it("取り消されたら状態を残さない", () => {
        const calls: string[] = [];
        const { result } = renderHook(() => useSwipe({ onSwipeLeft: () => calls.push("left") }));
        const ev = (x: number, y: number) => ({
            touches: [{ clientX: x, clientY: y }], preventDefault: () => { },
        } as unknown as React.TouchEvent);
        act(() => {
            result.current.handlers.onTouchStart(ev(200, 200));
            result.current.handlers.onTouchMove(ev(120, 205));
            result.current.handlers.onTouchCancel(ev(120, 205));
            result.current.handlers.onTouchEnd(ev(120, 205));
        });
        expect(calls, "取り消されたのに送っている").toEqual([]);
    });
});
