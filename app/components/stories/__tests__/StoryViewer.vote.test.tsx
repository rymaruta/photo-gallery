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
    // サーバーの文言を出す（常に fallback を返すモックだと、応答を無視する変異が通る）
    readApiError: async (res: { json?: () => Promise<{ error?: string }> }, fallback: string) => {
        try { return (await res.json?.())?.error || fallback; } catch { return fallback; }
    },
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
        // 一覧は未投票者に `vote: {}` を運ぶ（`getStories`）。**空でも押せる**——
        // `{}` は truthy なので、`item.vote ?? votes[id]` の順に書くと入れた票が効かない
        view(othersGroups({ vote: {} }));
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

    it("自分のストーリーでは押せず、0 票なら「まだ票はありません」", async () => {
        view(ownGroups({ vote: { counts: { a: 0, b: 0 } } }));
        expect(voteButtons(), "自分の投票に押せる").toHaveLength(0);
        expect(card()!.textContent).toContain("まだ票はありません");
        expect(card()!.textContent).not.toMatch(/%/);
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
        const alert = await screen.findByRole("alert");
        expect(alert, "サーバーの文言を出していない").toHaveTextContent("送信に失敗しました");
        // **返信の帯（bottom-0・高さ約 7.5rem）の上に出す**——`keepError` の位置
        // （bottom-16）だと帯の裏に隠れ、押したのに何も起きないように見える
        expect(alert.style.bottom, "返信の帯の裏に隠れる位置").toContain("7.5rem");
        expect(voteButtons(), "失敗したのに押せなくなっている").toHaveLength(2);
    });

    it("応答が来ない（ネットワーク）なら既定の文言", async () => {
        mockUserFetch.mockImplementation(async (url: string) => {
            if (String(url).includes("/vote")) throw new Error("offline");
            return { ok: true, json: async () => ({}) };
        });
        view(othersGroups());
        await userEvent.click(screen.getByRole("button", { name: "「はい」に投票" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("投票を送れませんでした");
    });

    /**
     * **応答を待つ間に手で次へ進んでも、票は押した時点のストーリーに付く。**
     * 送り先も書き先も `target`（押した時点）で、表示中のものではない。
     * 表示中に書くと、s1 で押した票が s2 に付き、s2 の2択が消える
     */
    const twoStories = (): StoryGroup[] => [{
        userId: "friend", displayName: "友人",
        items: [base("friend"), base("friend", { id: "s2", src: "https://cdn/x/b.jpg" })],
    }];
    const hold = () => {
        let release!: (v: unknown) => void;
        mockUserFetch.mockImplementation((url: string) => (
            String(url).includes("/vote")
                ? new Promise((r) => { release = r; })
                : Promise.resolve({ ok: true, json: async () => ({}) })
        ));
        return () => release;
    };

    it("送信中に次へ進んでも、票は押したストーリーに付く（次のストーリーの2択は残る）", async () => {
        const release = hold();
        view(twoStories());
        await userEvent.click(screen.getByRole("button", { name: "「はい」に投票" }));
        await waitFor(() => expect(votePosts()).toHaveLength(1));
        fireEvent.keyDown(document, { key: "ArrowRight" });   // 手で次へ（s2）
        release()({ ok: true, json: async () => ({ success: true, myVote: "a", counts: { a: 1, b: 0 } }) });
        await new Promise((r) => setTimeout(r, 30));
        expect(voteButtons(), "s1 の票が s2 に付いた（s2 の2択が消えた）").toHaveLength(2);
        expect(card()!.textContent, "s1 の数が s2 に出ている").not.toMatch(/%/);
        fireEvent.keyDown(document, { key: "ArrowLeft" });    // s1 へ戻る
        await waitFor(() => expect(voteButtons(), "s1 に入れた票が効いていない").toHaveLength(0));
        expect(card()!.textContent).toContain("✓ はい 100%");
    });

    it("送信中に次へ進んで失敗しても、次のストーリーの画面に文言を出さない", async () => {
        const release = hold();
        view(twoStories());
        await userEvent.click(screen.getByRole("button", { name: "「はい」に投票" }));
        await waitFor(() => expect(votePosts()).toHaveLength(1));
        fireEvent.keyDown(document, { key: "ArrowRight" });
        release()({ ok: false, status: 500, json: async () => ({ error: "送信に失敗しました" }) });
        await new Promise((r) => setTimeout(r, 30));
        expect(screen.queryByRole("alert"), "送っていないストーリーの画面に失敗の文言が出ている").toBeNull();
        expect(voteButtons()).toHaveLength(2);
    });

    // 投票スタンプの無いストーリーには何も出ない（回帰）
    it("投票スタンプが無ければ、カードも押す口も無い", async () => {
        view(othersGroups({ texts: [TEXT] }));
        expect(card()).toBeNull();
        expect(voteButtons()).toHaveLength(0);
        await settle();
    });
});
