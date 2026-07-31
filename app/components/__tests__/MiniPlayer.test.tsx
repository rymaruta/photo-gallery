import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("MiniPlayer 配置クランプ（メニューバーを塞がない）", () => {
    it("デスクトップ: 保存位置が右上(ヘッダー上)でも、y はヘッダー帯の下へ押し下げられる", async () => {
        setDesktop(true);
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
        // 画面内に収まる
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left).toBeLessThanOrEqual(1024);
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
