import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

// 曲の札を写真に焼き込んだ1本（アプリの作る画面）は、曲の帯に曲名を出さない
// ——写真の上の札と2度出る（2026-09-30・owner「曲名が2か所に出てやだ」）。
// **帯（音を出す／止めるボタン）は残す**

vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    publicFetch: vi.fn(),
    userPublicFetch: vi.fn(),
}));

import StoryViewer from "../StoryViewer";

beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true, writable: true, value: () => Promise.resolve(),
    });
});

const groups = (extra: Record<string, unknown>) => ([{
    userId: "me", displayName: "自分",
    items: [{
        id: "s1", src: "https://cdn/x/a.jpg", userId: "me", mediaType: "image",
        createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z",
        song: { title: "海の曲", artist: "歌手", previewUrl: "https://audio-ssl.itunes.apple.com/p.m4a" },
        ...extra,
    }],
}] as unknown as StoryGroup[]);

const view = (extra: Record<string, unknown>) => render(
    <StoryViewer groups={groups(extra)} initialGroupIndex={0} locale="ja"
        ownUserId="me" isAuthenticated onSeen={vi.fn()} onClose={vi.fn()} />,
);

describe("曲の札を焼き込んだストーリー", () => {
    it("曲名を出さない・音のボタンは残す", () => {
        view({ songOnPhoto: true });
        expect(screen.queryByText(/海の曲/), "写真の上の札と2度出している").toBeNull();
        expect(screen.getByRole("button", { name: /音を出す|ミュート/ })).toBeInTheDocument();
    });

    it("印の無い1本（Web で出した曲）は今までどおり曲名を出す", () => {
        view({});
        expect(screen.getByText(/海の曲/)).toBeInTheDocument();
    });
});
