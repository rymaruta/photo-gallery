import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { useRef } from "react";
import { render, act } from "@testing-library/react";
import { useMediaBox } from "../useMediaBox";

// jsdom に ResizeObserver は無い。**観測した相手を記録する**偽物を置く。
// 「測れているか」ではなく「**いま画面に居る要素を見張っているか**」を見る。
const observed: HTMLElement[] = [];
const unobserved: HTMLElement[] = [];
let fire: (() => void) | null = null;

class FakeResizeObserver {
    constructor(cb: () => void) { fire = cb; }
    observe(el: HTMLElement) { observed.push(el); }
    unobserve(el: HTMLElement) { unobserved.push(el); }
    disconnect() { fire = null; }
}

function Harness({ kind }: { kind: "img" | "video" }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { attach, box } = useMediaBox(containerRef);
    return (
        <div ref={containerRef} data-testid="container">
            {kind === "img"
                // eslint-disable-next-line @next/next/no-img-element
                ? <img ref={attach} data-testid="media" alt="" />
                : <video ref={attach} data-testid="media" />}
            {/* **位置まで出す。** 大きさだけ見ていると、囲みからの相対に
                する引き算（`a.left - b.left`）を丸ごと落としても緑のままだった */}
            <span data-testid="box">{box ? `${box.left},${box.top} ${box.width}x${box.height}` : "null"}</span>
        </div>
    );
}

describe("useMediaBox", () => {
    beforeEach(() => {
        observed.length = 0;
        unobserved.length = 0;
        fire = null;
        vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    });

    it("差し替わった絵を見張り直す（video → img で要素ごと入れ替わる）", () => {
        const { rerender, getByTestId } = render(<Harness kind="video" />);
        const first = getByTestId("media");
        expect(observed).toContain(first);

        // 種別が変わると DOM の要素ごと入れ替わる＝ref コールバックが
        // null → 新しい要素 の順で呼ばれる。
        rerender(<Harness kind="img" />);
        const second = getByTestId("media");
        expect(second).not.toBe(first);

        // **いま画面に居るのは second。** ここを見張っていないと、
        // 絵そのものの大きさが変わっても測り直しが走らない
        // （囲みと window は別に見ているので、絵だけが変わる回に効く）。
        expect(observed).toContain(second);
    });

    it("外した要素は見張りから外す（消えた要素を握り続けない）", () => {
        const { rerender, getByTestId } = render(<Harness kind="video" />);
        const first = getByTestId("media");
        rerender(<Harness kind="img" />);
        expect(unobserved).toContain(first);
    });

    it("レイアウトが無い環境（全部0）は「測れていない」= null", () => {
        const { getByTestId } = render(<Harness kind="img" />);
        expect(getByTestId("box").textContent).toBe("null");
    });

    it("測れたら囲みからの相対で返す", () => {
        const { getByTestId } = render(<Harness kind="img" />);
        const media = getByTestId("media");
        const container = getByTestId("container");
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
            { left: 10, top: 20, width: 300, height: 600, right: 310, bottom: 620, x: 10, y: 20, toJSON: () => ({}) } as DOMRect);
        vi.spyOn(media, "getBoundingClientRect").mockReturnValue(
            { left: 10, top: 120, width: 300, height: 400, right: 310, bottom: 520, x: 10, y: 120, toJSON: () => ({}) } as DOMRect);
        act(() => { fire?.(); });
        // 囲みは (10,20)・絵は (10,120) なので、相対では (0,100)。
        expect(getByTestId("box").textContent).toBe("0,100 300x400");
    });
});
