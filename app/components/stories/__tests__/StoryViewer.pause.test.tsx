import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

// **止める手段が「押しっぱなし」しか無かった。** 読む速さは人によって違うのに、
// 指を離すと進む＝自分で決められない。キーボードだけの人には手段が無い
// （キーは Escape と ← → だけだった）。画面に停止ボタンを置き、
// スペースでも止められるようにする。

vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    publicFetch: vi.fn(),
    userPublicFetch: vi.fn(),
}));

import StoryViewer from "../StoryViewer";

const groups = [{
    userId: "me", displayName: "自分",
    items: [{
        id: "s1", src: "https://cdn/x/a.jpg", userId: "me", mediaType: "image",
        createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z",
    }],
}] as unknown as StoryGroup[];

/** 画像の自動送りを駆動している CSS アニメーションの状態 */
const playState = () =>
    document.querySelector<HTMLElement>(".story-progress-fill")?.style.animationPlayState;

const view = () => render(
    <StoryViewer groups={groups} initialGroupIndex={0} locale="ja" ownUserId="me" isAuthenticated onSeen={vi.fn()} onClose={vi.fn()} />,
);

/** 「動きを減らす」設定を模す（jsdom には matchMedia が無い） */
function setReducedMotion(reduce: boolean) {
    Object.defineProperty(window, "matchMedia", {
        configurable: true, writable: true,
        value: (q: string) => ({ matches: reduce && q.includes("reduced-motion"), media: q, addEventListener: () => {}, removeEventListener: () => {} }),
    });
}

beforeEach(() => { document.body.innerHTML = ""; setReducedMotion(false); });

describe("ストーリーの自動送りを止める", () => {
    it("既定では進む", () => {
        view();
        expect(playState()).toBe("running");
    });

    it("停止ボタンで止まり、もう一度押すと再開する", () => {
        view();
        fireEvent.click(screen.getByLabelText("一時停止"));
        expect(playState()).toBe("paused");
        // 押した状態は支援技術にも伝える
        expect(screen.getByLabelText("再生")).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(screen.getByLabelText("再生"));
        expect(playState()).toBe("running");
    });

    it("スペースキーでも止まる（キーボードだけの人の唯一の手段）", () => {
        view();
        fireEvent.keyDown(document, { key: " " });
        expect(playState()).toBe("paused");
        fireEvent.keyDown(document, { key: " " });
        expect(playState()).toBe("running");
    });

    // **ボタンで止めたぶんを、指を離したときに再開しない。**
    // 長押しの解除は「長押しで止めたとき」だけ効かせる
    it("ボタンで止めたあと、画面に触れて離しても止まったまま", () => {
        const { container } = view();
        fireEvent.click(screen.getByLabelText("一時停止"));
        const zone = container.querySelector(".w-1\\/3")!;
        fireEvent.pointerDown(zone, { clientX: 10, clientY: 10 });
        fireEvent.pointerUp(zone);
        expect(playState(), "ボタンで止めたのに指を離して再開している").toBe("paused");
    });

    // 逆向き: 長押しで止めたぶんは、指を離したら今までどおり再開する
    it("長押しで止めたぶんは、指を離すと再開する", () => {
        const { container } = view();
        const zone = container.querySelector(".w-1\\/3")!;
        fireEvent.pointerDown(zone, { clientX: 10, clientY: 10 });
        expect(playState()).toBe("paused");
        fireEvent.pointerUp(zone);
        expect(playState()).toBe("running");
    });

    // **「動きを減らす」設定なら、最初から止めて出す。**
    // 自動送りは「勝手に進む動き」そのもの。ただし進む手段は残す
    // （`animation: none` にすると `onAnimationEnd` が来ず二度と進まない）
    it("動きを減らす設定なら、開いた時点で止まっている", () => {
        setReducedMotion(true);
        view();
        expect(playState()).toBe("paused");
        // 進めなくなってはいけない: 押せば再開する
        fireEvent.click(screen.getByLabelText("再生"));
        expect(playState()).toBe("running");
    });

    it("設定が無ければ、今までどおり進む", () => {
        setReducedMotion(false);
        view();
        expect(playState()).toBe("running");
    });
});
