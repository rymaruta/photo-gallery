import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

// **ここが最悪ケース**（`mediaHosts.ts` のコメントが名指ししている）:
//   - `preload="auto"` なので、開いた瞬間に取りに行く（再生を押す前）
//   - ストーリーはログイン中の全員のトレイに出る
// サーバーの許可リストは「これから保存する値」にしか効かないので、
// 許可リスト以前の行は任意のホストのまま残りうる。出すときにも確かめる。
//
// **`MusicContext` を「唯一の <audio>」と書いて、この経路を塞ぎ忘れた**
// （`grep` せずに書いた）。同じ差分の中でコメントも直した。

vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    publicFetch: vi.fn(),
    userPublicFetch: vi.fn(),
}));

import StoryViewer from "../StoryViewer";

// jsdom は `HTMLMediaElement.play()` を実装していない（undefined が返る）
beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true, writable: true, value: () => Promise.resolve(),
    });
});

const withSong = (previewUrl: string) => ([{
    userId: "me", displayName: "自分",
    items: [{
        id: "s1", src: "https://cdn/x/a.jpg", userId: "me", mediaType: "image",
        createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z",
        song: { title: "曲", artist: "歌手", previewUrl },
    }],
}] as unknown as StoryGroup[]);

const view = (previewUrl: string) => render(
    <StoryViewer groups={withSong(previewUrl)} initialGroupIndex={0} locale="ja"
        ownUserId="me" isAuthenticated onSeen={vi.fn()} onClose={vi.fn()} />,
);

describe("ストーリーの曲: 出すときにも許可ホストか確かめる", () => {
    it("許可していないホストは先読みしない", () => {
        view("https://evil.example/p.m4a");
        const audio = document.querySelector("audio");
        // **`src=""` では駄目**（空の src は現在のページを取り直す）
        expect(audio?.hasAttribute("src"), "外部の音源を先読みしている").toBe(false);
    });

    it("紛らわしいホストも先読みしない", () => {
        view("https://evil-mzstatic.com/p.m4a");
        expect(document.querySelector("audio")?.hasAttribute("src")).toBe(false);
    });

    // 正常系: Apple のホストは今までどおり鳴らす（塞ぎすぎない）
    it("Apple のホストはそのまま鳴らす", () => {
        view("https://audio-ssl.itunes.apple.com/p.m4a");
        expect(document.querySelector("audio")?.getAttribute("src"))
            .toBe("https://audio-ssl.itunes.apple.com/p.m4a");
    });
});
