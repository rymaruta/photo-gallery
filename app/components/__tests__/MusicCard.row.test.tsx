import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const play = vi.fn();
const next = vi.fn();
const prev = vi.fn();
vi.mock("../../music/MusicContext", () => ({
    useMusic: () => ({ queueKey: "bgm:u1", index: 0, playing: false, play, next, prev, getAudio: () => null }),
}));
vi.mock("../SmoothProgress", () => ({ default: () => null }));
const MusicCard = (await import("../MusicCard")).default;

const SONGS = [
    { title: "LADY", artist: "米津玄師", previewUrl: "https://audio-ssl.itunes.apple.com/a.m4a" },
    { title: "Lemon", artist: "米津玄師", previewUrl: "https://audio-ssl.itunes.apple.com/b.m4a" },
];

/** 2026-10-31 束 1 U8: 人のページのマイ BGM は札の行 64（iOS の札の行の形・比較の板 ProfileCompare の 8） */
describe("MusicCard の札の行（row）", () => {
    it("64 の行に 眉（何曲目）・題 15・歌い手 12・再生 44。見出しの段や点の送りは出さない", () => {
        render(<MusicCard queueKey="bgm:u1" songs={SONGS} label="マイBGM" locale="ja" row />);
        const r = screen.getByTestId("music-row");
        expect(r.className).toContain("min-h-[64px]");
        expect(r.textContent).toContain("マイBGM · 1/2");
        expect(screen.getByText("LADY").style.fontSize).toBe("15px");
        expect(screen.getByText("米津玄師").style.fontSize).toBe("12px");
        const btn = screen.getByRole("button", { name: "再生" });
        expect(btn.className).toContain("w-11");
        expect(btn.className).toContain("bg-accent-fill");
        fireEvent.click(btn);
        expect(play).toHaveBeenCalled();
    });

    it("左へ払うと次の曲・右へ払うと前の曲。縦の動きでは送らない", () => {
        render(<MusicCard queueKey="bgm:u1" songs={SONGS} label="マイBGM" locale="ja" row />);
        const r = screen.getByTestId("music-row");
        fireEvent.pointerDown(r, { clientX: 200, clientY: 10 });
        fireEvent.pointerUp(r, { clientX: 100, clientY: 14 });
        expect(next).toHaveBeenCalledTimes(1);
        fireEvent.pointerDown(r, { clientX: 100, clientY: 10 });
        fireEvent.pointerUp(r, { clientX: 200, clientY: 12 });
        expect(prev).toHaveBeenCalledTimes(1);
        fireEvent.pointerDown(r, { clientX: 100, clientY: 10 });
        fireEvent.pointerUp(r, { clientX: 150, clientY: 200 });
        expect(next).toHaveBeenCalledTimes(1);
        expect(prev).toHaveBeenCalledTimes(1);
    });
});
