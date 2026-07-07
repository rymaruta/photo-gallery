import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SongPlayer from "../SongPlayer";

// jsdom は HTMLMediaElement.play/pause を実装しないためスタブする
beforeAll(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => { /* noop */ });
});

const props = {
    title: "夜に駆ける",
    artist: "YOASOBI",
    artwork: "https://cdn.test/art.jpg",
    previewUrl: "https://cdn.test/preview.m4a",
    trackUrl: "https://music.apple.com/jp/album/x/1?i=2",
};

describe("SongPlayer", () => {
    it("曲名・アーティスト・アートワークを表示する", () => {
        const { container } = render(<SongPlayer {...props} />);
        expect(screen.getByText("夜に駆ける")).toBeTruthy();
        expect(screen.getByText("YOASOBI")).toBeTruthy();
        const img = container.querySelector("img");
        expect(img?.getAttribute("src")).toBe(props.artwork);
    });

    it("再生ボタンで play() を呼び、再生/一時停止イベントでアイコンが切り替わる", () => {
        const { container } = render(<SongPlayer {...props} />);
        fireEvent.click(screen.getByRole("button", { name: "再生" }));
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

        const audio = container.querySelector("audio")!;
        fireEvent.play(audio);
        expect(screen.getByRole("button", { name: "一時停止" })).toBeTruthy();
        fireEvent.pause(audio);
        expect(screen.getByRole("button", { name: "再生" })).toBeTruthy();
    });

    it("trackUrl があるとタイトルが外部リンクになる", () => {
        render(<SongPlayer {...props} />);
        const link = screen.getByRole("link", { name: "夜に駆ける" });
        expect(link.getAttribute("href")).toBe(props.trackUrl);
        expect(link.getAttribute("target")).toBe("_blank");
    });

    it("trackUrl が無ければタイトルはリンクにならない", () => {
        render(<SongPlayer {...props} trackUrl={undefined} />);
        expect(screen.queryByRole("link", { name: "夜に駆ける" })).toBeNull();
        expect(screen.getByText("夜に駆ける")).toBeTruthy();
    });

    it("ラベル未指定なら『マイBGM』を表示する", () => {
        render(<SongPlayer {...props} />);
        expect(screen.getByText("マイBGM")).toBeTruthy();
    });
});
