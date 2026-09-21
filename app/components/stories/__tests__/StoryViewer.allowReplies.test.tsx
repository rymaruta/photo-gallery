import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";
import { STORY_REACTIONS } from "@/lib/stories";

/**
 * 投稿者が「返信を許可」を切ったストーリー。
 *
 * **押せない入口を出さない。** 断るのはサーバー（`postStoryReply` が 403）で、
 * ここは帯ごと出さないだけ——画面だけで隠すと直接叩く経路が素通りになるし、
 * 逆にサーバーだけだと「送ったのに弾かれる」が毎回起きる。
 *
 * **無い＝受ける。** この列が生まれる前の投稿が黙って返信を失わないこと
 * まで見る（そこを逆にすると、既にあるストーリー全部の帯が消える）。
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

const groups = (allowReplies?: boolean): StoryGroup[] => [{
    userId: "friend",
    displayName: "友人",
    items: [{
        id: "s1", src: "https://cdn/x/a.jpg", userId: "friend",
        createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z",
        ...(allowReplies === undefined ? {} : { allowReplies }),
    }],
}];

const view = (allowReplies?: boolean) => {
    const r = render(
        <StoryViewer
            groups={groups(allowReplies)}
            initialGroupIndex={0}
            locale="ja"
            isAuthenticated
            ownUserId="me"
            onSeen={() => { /* noop */ }}
            onClose={() => { /* noop */ }}
        />,
    );
    // jsdom は画像を読まないので、読み終わりを模さないと開いた直後で凍る
    const el = document.querySelector("img.story-media-in, video.story-media-in");
    if (el) fireEvent.load(el);
    return r;
};

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe("StoryViewer: 返信を許可", () => {
    it("切ってあるストーリーには返信の帯を出さない", () => {
        view(false);
        expect(screen.queryByLabelText("このストーリーに返信"), "入力欄が出ている").toBeNull();
        expect(screen.queryByLabelText(`${STORY_REACTIONS[0]} で反応する`), "リアクションが出ている").toBeNull();
    });

    it("`allowReplies` を持たない投稿は今までどおり返信できる", () => {
        view(undefined);
        expect(screen.getByLabelText("このストーリーに返信")).toBeTruthy();
        expect(screen.getByLabelText(`${STORY_REACTIONS[0]} で反応する`)).toBeTruthy();
    });

    it("true を明示した投稿も返信できる", () => {
        view(true);
        expect(screen.getByLabelText("このストーリーに返信")).toBeTruthy();
    });
});
