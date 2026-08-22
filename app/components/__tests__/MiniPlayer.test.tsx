import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

// 回帰ガード: デスクトップでミニプレイヤーをヘッダー(メニューバー)の上に置こうとしても、
// コンポーネントがヘッダー帯を避けて配置し、メニューボタンを塞がないことを保証する。
// （過去、ドラッグ式ミニプレイヤーがヘッダーに被さりメニューが押せなくなる不具合があった）

const music = vi.hoisted(() => ({
    current: { title: "Song", artist: "Artist", artwork: "", previewUrl: "https://x/y.mp3" },
    playing: false,
    queue: [{ title: "Song", previewUrl: "https://x/y.mp3" }],
    label: "マイBGM",
    shuffle: false,
    repeatOne: false,
    play: vi.fn(), toggle: vi.fn(), next: vi.fn(), prev: vi.fn(), stop: vi.fn(),
    toggleShuffle: vi.fn(), toggleRepeatOne: vi.fn(), getAudio: () => null,
}));

vi.mock("../../music/MusicContext", () => ({ useMusic: () => music }));

import MiniPlayer from "../MiniPlayer";

const STORAGE_KEY = "jp_miniplayer_pos";

function setDesktop(matches: boolean) {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: () => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }),
    });
}

beforeEach(() => {
    cleanup();
    localStorage.clear();
    // jsdom 既定の 1024x768 を明示
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 768 });
});

// jsdom は offsetWidth/offsetHeight が常に 0。以前はそのまま w=0 で
// クランプ結果を見ていて、「left ≤ 1024」の検証は**箱が丸ごと画面外**
// （left=1024 に幅448の箱＝右端1472）でも通っていた。実寸を与えて測る。
const BOX_W = 448;
const BOX_H = 60;
const origOffsetW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const origOffsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
function stubBoxSize() {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => BOX_W });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => BOX_H });
}
afterEach(() => {
    if (origOffsetW) Object.defineProperty(HTMLElement.prototype, "offsetWidth", origOffsetW);
    if (origOffsetH) Object.defineProperty(HTMLElement.prototype, "offsetHeight", origOffsetH);
});

describe("MiniPlayer 配置クランプ（メニューバーを塞がない）", () => {
    it("デスクトップ: 保存位置が右上(ヘッダー上)でも、y はヘッダー帯の下へ押し下げられる", async () => {
        setDesktop(true);
        stubBoxSize();
        // ヘッダー上（y=0）かつ画面外まで右（x=99999）を保存 → 修正前はここに居座り header を覆う
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 99999, y: 0 }));

        const { container } = render(<MiniPlayer />);

        await waitFor(() => {
            const root = container.firstChild as HTMLElement | null;
            expect(root).toBeTruthy();
            // 自由配置になっている（left/top が付く）
            expect(root!.style.top).not.toBe("");
        });

        const root = container.firstChild as HTMLElement;
        const top = parseFloat(root.style.top);
        const left = parseFloat(root.style.left);
        // ヘッダー帯(<header>不在なので既定 72+8=80)より下 = メニューボタンを塞がない
        expect(top).toBeGreaterThanOrEqual(80);
        // **右端まで**画面内に収まる（left だけ見ると幅0の検証になる）
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left + BOX_W).toBeLessThanOrEqual(1024);
    });

    // deps を [pos] にしていた頃は、位置が変わるたび（ドラッグ中は毎フレーム）
    // リスナが外れて張り直されていた。購読は1回のまま、リサイズで
    // クランプが効き続けることを見る。
    it("リサイズの購読は1回だけで、リサイズのたびに画面内へ収め直す", async () => {
        setDesktop(true);
        stubBoxSize();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 100, y: 200 }));
        const addSpy = vi.spyOn(window, "addEventListener");

        const { container } = render(<MiniPlayer />);
        await waitFor(() => expect((container.firstChild as HTMLElement).style.top).not.toBe(""));

        // 画面を狭くしてリサイズ → 位置が収め直される（購読が生きている）
        Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 600 });
        window.dispatchEvent(new Event("resize"));
        await waitFor(() => {
            const left = parseFloat((container.firstChild as HTMLElement).style.left);
            expect(left + BOX_W).toBeLessThanOrEqual(600);
        });
        Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 500 });
        window.dispatchEvent(new Event("resize"));
        await waitFor(() => {
            const left = parseFloat((container.firstChild as HTMLElement).style.left);
            expect(left + BOX_W).toBeLessThanOrEqual(500);
        });

        // 位置が2回変わっても resize の購読は最初の1回だけ
        const resizeAdds = addSpy.mock.calls.filter((c) => c[0] === "resize").length;
        expect(resizeAdds).toBe(1);
        addSpy.mockRestore();
    });

    it("モバイル(タッチ): ドラッグ無効。既定の下部固定のまま top を持たない", () => {
        setDesktop(false);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 99999, y: 0 }));

        const { container } = render(<MiniPlayer />);
        const root = container.firstChild as HTMLElement;
        // 下部固定 = top ではなく bottom を使う（ヘッダーとは無関係の位置）
        expect(root.style.top).toBe("");
        expect(root.className).toContain("inset-x-3");
    });

    it("z-index はヘッダー(z-50)より下(z-40)＝万一被っても hit-test で負ける", () => {
        setDesktop(false);
        const { container } = render(<MiniPlayer />);
        const root = container.firstChild as HTMLElement;
        expect(root.className).toContain("z-40");
        expect(root.className).not.toContain("z-[70]");
    });
});
