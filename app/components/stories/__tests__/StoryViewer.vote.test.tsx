import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoryGroup } from "@/lib/stories";
import type { StoryText } from "@/lib/utils/storyText";

/**
 * 投票スタンプ（見る側）。
 *
 * **押せる形にするのは、票を送る口があるときだけ。** 未ログイン・自分の
 * ストーリー・投票済みでは `<button>` を置かない（押しても効かない的）。
 * 断る条件（ブロック・フォロワー限定・投票済み）はサーバー（`voteStory`）
 * が持ち、ここは入口を出すかどうかだけ決める。
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

const VOTE: StoryText = { kind: "vote", question: "この景色、好き？", options: ["はい", "いいえ"], x: 0.5, y: 0.6, size: 0.05 };
const TEXT: StoryText = { text: "朝", x: 0.5, y: 0.3, size: 0.06, font: "bold", color: "white", bg: "none" };

const base = (userId: string, over: Record<string, unknown> = {}) => ({
    id: "s1", src: "https://cdn/x/a.jpg", userId,
    createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z",
    texts: [TEXT, VOTE], ...over,
});

/** 他人のストーリー（票を入れる側） */
const othersGroups = (over: Record<string, unknown> = {}): StoryGroup[] => [{
    userId: "friend", displayName: "友人", items: [base("friend", over)],
}];
/** 自分のストーリー（結果を見る側） */
const ownGroups = (over: Record<string, unknown> = {}): StoryGroup[] => [{
    userId: "me", displayName: "自分", items: [base("me", over)],
}];

function markMediaLoaded() {
    const el = document.querySelector("img.story-media-in, video.story-media-in");
    if (el) fireEvent.load(el);
}

const view = (groups: StoryGroup[], props: Partial<React.ComponentProps<typeof StoryViewer>> = {}) => {
    const r = render(
        <StoryViewer
            groups={groups}
            initialGroupIndex={0}
            locale="ja"
            isAuthenticated
            ownUserId="me"
            onSeen={() => { /* noop */ }}
            onClose={() => { /* noop */ }}
            {...props}
        />,
    );
    markMediaLoaded();
    return r;
};

/**
 * Viewer 自身が撃つ要求（閲覧の記録 `/view`・閲覧者 `/viewers`）を着地させる。
 * 押さないテストでもこれを待たないと、下の afterEach の見張りに掛かり、
 * **cleanup が走らず古い DOM が次のテストに残る**（ボタンが2つ見える）
 */
const settle = () => new Promise((r) => setTimeout(r, 30));
const votePosts = () => mockUserFetch.mock.calls.filter(
    (c) => String(c[0]).includes("/vote") && (c[1] as { method?: string })?.method === "POST");
const voteButtons = () => screen.queryAllByRole("button", { name: /「.+」に投票/ });
const card = () => document.querySelector("[data-story-vote]") as HTMLElement | null;

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
});

// 自分が始めた要求を自分で着地させてから終わる（`StoryViewer.reply.test.tsx` と同じ見張り）
afterEach(async () => {
    const before = mockUserFetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    const late = mockUserFetch.mock.calls.slice(before).map((c) => String(c[0]));
    expect(late, "テストが終わったあとに要求が着地している").toEqual([]);
});

describe("投票スタンプ（見る側）", () => {
    it("他人のストーリーでは2択が押せる。押すとそのストーリーへ送る", async () => {
        mockUserFetch.mockImplementation(async (url: string) => (
            String(url).includes("/vote")
                ? { ok: true, json: async () => ({ success: true, myVote: "b", counts: { a: 3, b: 1 } }) }
                : { ok: true, json: async () => ({}) }
        ));
        view(othersGroups());
        expect(card(), "投票のカードが出ていない").not.toBeNull();
        expect(voteButtons()).toHaveLength(2);
        await userEvent.click(screen.getByRole("button", { name: "「いいえ」に投票" }));

        await waitFor(() => expect(votePosts()).toHaveLength(1));
        const [url, init] = votePosts()[0] as [string, { body: string }];
        expect(url).toBe("/stories/s1/vote");
        expect(JSON.parse(init.body)).toEqual({ choice: "b" });

        // 入れたら押せなくなり、数（割合）が出る。自分の票に印
        await waitFor(() => expect(voteButtons(), "入れたのにまだ押せる").toHaveLength(0));
        expect(card()!.textContent).toContain("はい 75%");
        expect(card()!.textContent).toContain("✓ いいえ 25%");
    });

    // **数は見えない。** 入れる前に見えると多い方に寄る（サーバーが付けない）
    it("入れる前は数を出さない", async () => {
        view(othersGroups());
        expect(card()!.textContent).not.toMatch(/%/);
        await settle();
    });

    it("一覧が「投票済み」を運んできたら、押せない形で数を出す", async () => {
        view(othersGroups({ vote: { myVote: "a", counts: { a: 2, b: 2 } } }));
        expect(voteButtons(), "投票済みなのに押せる").toHaveLength(0);
        expect(card()!.textContent).toContain("✓ はい 50%");
        expect(card()!.textContent).toContain("いいえ 50%");
        await settle();
    });

    it("自分のストーリーでは押せず、数が見える（0票でも）", async () => {
        view(ownGroups({ vote: { counts: { a: 0, b: 0 } } }));
        expect(voteButtons(), "自分の投票に押せる").toHaveLength(0);
        expect(card()!.textContent).toContain("はい 0%");
        expect(card()!.textContent).toContain("いいえ 0%");
        await settle();
    });

    // 未ログインは返信と同じ——押してから断る形にしない
    it("未ログインでは押せない", async () => {
        view(othersGroups(), { isAuthenticated: false, ownUserId: null });
        expect(card(), "カード自体は見える").not.toBeNull();
        expect(voteButtons()).toHaveLength(0);
        await settle();
        expect(votePosts()).toHaveLength(0);
    });

    it("送れなかったら理由を出し、押せる形のまま", async () => {
        mockUserFetch.mockImplementation(async (url: string) => (
            String(url).includes("/vote")
                ? { ok: false, status: 500, json: async () => ({ error: "送信に失敗しました" }) }
                : { ok: true, json: async () => ({}) }
        ));
        view(othersGroups());
        await userEvent.click(screen.getByRole("button", { name: "「はい」に投票" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("投票を送れませんでした");
        expect(voteButtons(), "失敗したのに押せなくなっている").toHaveLength(2);
    });

    // 送っている間は二度押しできず、自動送りも止まる
    it("送っている間は押せない（二度押ししない）", async () => {
        let release: (v: unknown) => void = () => { /* set below */ };
        mockUserFetch.mockImplementation((url: string) => (
            String(url).includes("/vote")
                ? new Promise((r) => { release = r; })
                : Promise.resolve({ ok: true, json: async () => ({}) })
        ));
        view(othersGroups());
        await userEvent.click(screen.getByRole("button", { name: "「はい」に投票" }));
        await waitFor(() => expect(votePosts()).toHaveLength(1));
        for (const b of voteButtons()) expect(b, "送っている間に押せる").toBeDisabled();
        // 応答を待っている間は自動送りも止める（`frozen`）——進んで次の
        // ストーリーへ行くと、どれに入れたのか分からなくなる
        const playState = () => (document.querySelector(".story-progress-fill") as HTMLElement | null)?.style.animationPlayState;
        expect(playState(), "応答を待っている間も進んでいる").toBe("paused");
        release({ ok: true, json: async () => ({ success: true, myVote: "a", counts: { a: 1, b: 0 } }) });
        await waitFor(() => expect(voteButtons()).toHaveLength(0));
        await waitFor(() => expect(playState(), "入れ終わったのに止まったまま").toBe("running"));
    });

    // 投票スタンプの無いストーリーには何も出ない（回帰）
    it("投票スタンプが無ければ、カードも押す口も無い", async () => {
        view(othersGroups({ texts: [TEXT] }));
        expect(card()).toBeNull();
        expect(voteButtons()).toHaveLength(0);
        await settle();
    });
});
