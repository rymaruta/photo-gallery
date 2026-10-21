import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PhotoViewer from "../PhotoViewer";

/**
 * 全画面の拡大と、拡大中の2回叩き（iOS の `DoubleTapLike`: 拡大中は倍率を戻す）。
 * 両指の広げは Pointer Events で組んでいるので、2本の指を順に置いて離して確かめる。
 */
const IMAGES = [{ src: "https://cdn.example.com/uploads/a/1.webp" }, { src: "https://cdn.example.com/uploads/a/2.webp" }];

function setup(over: Partial<React.ComponentProps<typeof PhotoViewer>> = {}) {
    const props = {
        images: IMAGES, index: 0, onIndexChange: vi.fn(), altFor: (i: number) => `写真${i + 1}`,
        title: "朝の湖", liked: false, likeCount: 3, onToggleLike: vi.fn(), onClose: vi.fn(), locale: "ja" as const,
        ...over,
    };
    render(<PhotoViewer {...props} />);
    return props;
}

const stage = () => screen.getByTestId("photo-viewer-stage");
const scaleOf = () => Number(stage().dataset.scale);

function pinch(from: number, to: number) {
    const s = stage();
    fireEvent.pointerDown(s, { pointerId: 1, clientX: 200 - from / 2, clientY: 300 });
    fireEvent.pointerDown(s, { pointerId: 2, clientX: 200 + from / 2, clientY: 300 });
    fireEvent.pointerMove(s, { pointerId: 2, clientX: 200 - from / 2 + to, clientY: 300 });
    fireEvent.pointerUp(s, { pointerId: 2, clientX: 200 - from / 2 + to, clientY: 300 });
    fireEvent.pointerUp(s, { pointerId: 1, clientX: 200 - from / 2, clientY: 300 });
}

/** 本物の叩きと同じ順（指を置く → 離す → click） */
function tap(x: number, y: number) {
    fireEvent.pointerDown(stage(), { pointerId: 9, clientX: x, clientY: y });
    fireEvent.pointerUp(stage(), { pointerId: 9, clientX: x, clientY: y });
    fireEvent.click(stage(), { clientX: x, clientY: y });
}

describe("PhotoViewer", () => {
    it("両指で広げると拡大し、離しても倍率を保つ（4倍まで）", () => {
        setup();
        expect(scaleOf()).toBe(1);
        pinch(100, 250);
        expect(scaleOf()).toBeCloseTo(2.5, 1);
        pinch(100, 1000);
        expect(scaleOf()).toBe(4);
    });

    it("拡大中の2回叩きは倍率を戻す（いいねにしない）", () => {
        const now = vi.spyOn(Date, "now");
        try {
            const p = setup();
            pinch(100, 250);
            now.mockReturnValue(5_000);
            tap(50, 50);
            now.mockReturnValue(5_150);
            tap(52, 50);
            expect(scaleOf()).toBe(1);
            expect(p.onToggleLike).not.toHaveBeenCalled();
        } finally {
            now.mockRestore();
        }
    });

    it("等倍で横に払うと次の写真、下に払うと閉じる", () => {
        const p = setup();
        fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 300, clientY: 300 });
        fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 180, clientY: 305 });
        fireEvent.pointerUp(stage(), { pointerId: 1, clientX: 180, clientY: 305 });
        expect(p.onIndexChange).toHaveBeenCalledWith(1);
        fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 200, clientY: 200 });
        fireEvent.pointerUp(stage(), { pointerId: 1, clientX: 205, clientY: 340 });
        expect(p.onClose).toHaveBeenCalled();
    });

    it("「1 / 2」を等幅の数字で出し、読み上げは「2枚中1枚目」", () => {
        setup();
        expect(screen.getByText("1 / 2").className).toContain("tabular-nums");
        expect(screen.getByText("2枚中1枚目")).toBeTruthy();
    });

    it("`+` で拡大、`0` で戻す。Esc で閉じる", () => {
        const p = setup();
        fireEvent.keyDown(window, { key: "+" });
        expect(scaleOf()).toBeCloseTo(1.5, 2);
        fireEvent.keyDown(window, { key: "0" });
        expect(scaleOf()).toBe(1);
        fireEvent.keyDown(document, { key: "Escape" });
        expect(p.onClose).toHaveBeenCalled();
    });

    it("下のいいねは数まで読ませ、押した状態は aria-pressed", () => {
        const p = setup({ liked: true });
        const btn = screen.getByRole("button", { name: "いいね 3件" });
        expect(btn.getAttribute("aria-pressed")).toBe("true");
        fireEvent.click(btn);
        expect(p.onToggleLike).toHaveBeenCalledTimes(1);
    });
});
