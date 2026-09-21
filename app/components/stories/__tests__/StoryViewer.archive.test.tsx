import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

/**
 * アーカイブのために足した2つ:
 *   - `initialItemIndex`: 押した1枚から開く（先頭からしか始められないと、
 *     30枚目を見るのに29回送る）
 *   - 「アーカイブに自動保存」の投稿には「残す」を出さない（残した写真と
 *     実体を共有するので、写真を消すとアーカイブごと消える。サーバーも
 *     409 で断る——押しても断られるだけのボタンを置かない）
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    userPublicFetch: vi.fn(async () => ({ ok: true, json: async () => ({ followers: 0, following: 0 }) })),
    readApiError: async (_res: unknown, fallback: string) => fallback,
    sessionErrorMessage: () => null,
}));

import StoryViewer from "../StoryViewer";

const own = (extra: Record<string, unknown> = {}): StoryGroup[] => [{
    userId: "me",
    displayName: "自分",
    items: [
        { id: "s1", src: "https://cdn/x/a.jpg", userId: "me", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z", ...extra },
        { id: "s2", src: "https://cdn/x/b.jpg", userId: "me", createdAt: "2026-07-04T11:00:00Z", expiresAt: "2099-07-05T11:00:00Z", ...extra },
        { id: "s3", src: "https://cdn/x/c.jpg", userId: "me", createdAt: "2026-07-04T12:00:00Z", expiresAt: "2099-07-05T12:00:00Z", ...extra },
    ],
}];

const view = (groups: StoryGroup[], initialItemIndex?: number) => {
    const r = render(
        <StoryViewer
            groups={groups}
            initialGroupIndex={0}
            initialItemIndex={initialItemIndex}
            locale="ja"
            isAuthenticated
            ownUserId="me"
            onSeen={() => { /* noop */ }}
            onClose={() => { /* noop */ }}
        />,
    );
    const el = document.querySelector("img.story-media-in, video.story-media-in");
    if (el) fireEvent.load(el);
    return r;
};
const shownSrc = () => document.querySelector("img.story-media-in, video.story-media-in")?.getAttribute("src") ?? "";

beforeEach(() => {
    // 閲覧者の取得など。中身は見ない
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ viewers: [], count: 0 }) });
});

describe("StoryViewer: initialItemIndex", () => {
    it("省略時は先頭から", () => {
        view(own());
        expect(shownSrc()).toContain("a.jpg");
    });

    it("指定した1枚から開く", () => {
        view(own(), 2);
        expect(shownSrc()).toContain("c.jpg");
    });
});

describe("StoryViewer: 「アーカイブに自動保存」の投稿には「残す」を出さない", () => {
    it("印のある自分の写真には出ない", () => {
        view(own({ archive: true }));
        expect(screen.queryByLabelText("ギャラリーに残す"), "断られるだけのボタンを出している").toBeNull();
    });

    it("印の無い自分の写真には今までどおり出る", () => {
        view(own());
        expect(screen.getByLabelText("ギャラリーに残す")).toBeTruthy();
    });
});
