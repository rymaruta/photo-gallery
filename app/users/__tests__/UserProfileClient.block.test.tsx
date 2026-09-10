import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **押せる場所がストーリーの返信一覧しか無かった。**
// 相手がストーリーに返信していなければ辿り着けない——コメントを
// 付けられても止められない。サーバー側（`POST/DELETE /users/{id}/block`）は
// 前から揃っていて、足りないのは押す場所だけだった。
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null, loading: false } }));

vi.mock("../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    readApiError: async (_r: unknown, fallback: string) => fallback,
}));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../auth/context", () => ({ useAuth: () => authState.current }));
// `viewerAuthed` / `isOwner` はこのセッションから決まる（`useAuth` ではない）
vi.mock("../../../lib/auth/cognito", () => ({
    getCurrentSession: async () => (authState.current.isAuthenticated
        ? { getIdToken: () => ({ payload: { sub: authState.current.userId } }) }
        : null),
}));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../components/FollowButton", () => ({ default: () => null, FollowAction: () => null }));
const mockSevered = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/hooks/useFollow", async (importActual) => ({
    ...(await importActual<typeof import("../../../lib/hooks/useFollow")>()),
    noteFollowSevered: (id: string) => mockSevered(id),
}));
vi.mock("../../components/MusicCard", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import UserProfileClient from "../UserProfileClient";

const OTHER = "22222222-2222-4222-8222-222222222222";
const view = () => render(<UserProfileClient userId={OTHER} />);
const blockCalls = (method: string) => mockUserFetch.mock.calls.filter(
    (c) => String(c[0]).includes("/block") && (c[1] as { method?: string })?.method === method);

beforeEach(() => {
    authState.current = { isAuthenticated: true, userId: "me", loading: false };
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
    mockShowToast.mockReset();
    mockSevered.mockReset();
});

describe("プロフィールからブロックする", () => {
    const openMenu = async () => {
        const user = userEvent.setup();
        await user.click(await screen.findByRole("button", { name: /共有|Share/ }));
        return user;
    };

    it("他人のプロフィールから押せる", async () => {
        view();
        const user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "この人をブロック" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        expect(blockCalls("POST")[0][0]).toBe(`/users/${OTHER}/block`);
    });

    // **何が起きるかを言う。ただし断定しない。**
    // `blockUser` は冪等に 200 を返すので、2回目に「外れました」と
    // 言い切ると、何も起きていないのに起きたように読める
    it("フォローも外れることを伝える（起きたと断定しない）", async () => {
        view();
        const user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "この人をブロック" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(mockShowToast.mock.calls[0][0]).toContain("フォローは外れます");
        expect(mockShowToast.mock.calls[0][0], "起きたことと断定している").not.toContain("外れました");
    });

    // **効いたときだけ画面を変える**（`StoryViewer` と同じ）
    it("失敗したら「解除」に変えない", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (String(url).includes("/block")) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view();
        const user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "この人をブロック" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        await user.click(await screen.findByRole("button", { name: /共有|Share/ }));
        expect(await screen.findByRole("menuitem", { name: "この人をブロック" }), "効いていないのに解除と出ている").toBeInTheDocument();
    });

    it("押し直すと解除できる", async () => {
        view();
        let user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "この人をブロック" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "ブロックを解除" }));
        await waitFor(() => expect(blockCalls("DELETE")).toHaveLength(1));
    });

    // **自分のプロフィールには出さない。** `!isOwner` を外しても5本とも
    // 緑だった（レビューが変異で実証）
    it("自分のプロフィールには出さない", async () => {
        const OWN = "11111111-1111-4111-8111-111111111111";
        authState.current = { isAuthenticated: true, userId: OWN, loading: false };
        render(<UserProfileClient userId={OWN} />);
        const user = userEvent.setup();
        await user.click(await screen.findByRole("button", { name: /共有|Share/ }));
        expect(screen.queryByRole("menuitem", { name: "この人をブロック" }), "自分をブロックできてしまう").toBeNull();
    });

    // **押す前に、戻せないことを言う。** ブロックは両向きのフォローを切り、
    // 解除しても戻らない。無害な4項目の隣に確認なしで置いていた
    it("押す前に、フォローが外れて戻らないことを出す", async () => {
        view();
        await openMenu();
        expect(await screen.findByText(/解除しても戻りません/)).toBeInTheDocument();
    });

    // **注意書きにも `!isOwner && viewerAuthed && !blocked` が要る。**
    // メニュー項目側の `!isOwner` は縛っていたが、注意書き側は無防備で、
    // `!blocked` だけに落としても全緑だった（レビューが変異で実証）
    // ——押せる項目が無い画面に「ブロックすると…」だけが出る
    it("自分のプロフィールには注意書きも出さない", async () => {
        const OWN = "11111111-1111-4111-8111-111111111111";
        authState.current = { isAuthenticated: true, userId: OWN, loading: false };
        render(<UserProfileClient userId={OWN} />);
        const user = userEvent.setup();
        await user.click(await screen.findByRole("button", { name: /共有|Share/ }));
        expect(screen.queryByText(/解除しても戻りません/), "押せる項目が無いのに注意書きだけ出ている").toBeNull();
    });

    it("未ログインには注意書きも出さない", async () => {
        authState.current = { isAuthenticated: false, userId: null, loading: false };
        view();
        await openMenu();
        await waitFor(() => expect(screen.queryByRole("menuitem", { name: "この人をブロック" })).toBeNull());
        expect(screen.queryByText(/解除しても戻りません/), "押せない人に注意書きだけ出している").toBeNull();
    });

    // ブロック済みなら「解除」しか出ないので、注意書きも引っ込める
    it("ブロック中は注意書きを出さない", async () => {
        view();
        const user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "この人をブロック" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        await user.click(await screen.findByRole("button", { name: /共有|Share/ }));
        await screen.findByRole("menuitem", { name: "ブロックを解除" });
        expect(screen.queryByText(/解除しても戻りません/), "解除しかできない画面に「ブロックすると」が出ている").toBeNull();
    });

    // **同じ画面のフォローの状態も直す。** 直さないと、トーストが
    // フォローも外れると言った直後に、すぐ下のボタンが「フォロー中」の
    // まま残る（共有ストアはログイン・ログアウトでしか捨てない）。
    //
    // **撃つのは `noteFollowSevered`。** ここに `resetFollowingCache()`
    // （ログアウト用）を書いていた回があり、あれは数のピルを消すだけで
    // 「フォロー中」は直らなかった。何が違うかは
    // `lib/hooks/__tests__/useFollow.sever.test.tsx` で振る舞いを見ている
    it("ブロックしたら、切れた相手を共有ストアから外す", async () => {
        view();
        const user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "この人をブロック" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        await waitFor(() => expect(mockSevered, "フォローの状態が古いまま残る").toHaveBeenCalledWith(OTHER));
    });

    // **解除では撃たない。** ブロックを外してもフォローは戻らないので、
    // 直すものが無い（撃つと数を取り直すだけ無駄が増える）
    it("解除では撃たない", async () => {
        view();
        let user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "この人をブロック" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        mockSevered.mockReset();
        user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "ブロックを解除" }));
        await waitFor(() => expect(blockCalls("DELETE")).toHaveLength(1));
        expect(mockSevered).not.toHaveBeenCalled();
    });

    it("失敗した回は撃たない（取り直しを無駄に増やさない）", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (String(url).includes("/block")) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view();
        const user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "この人をブロック" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        expect(mockSevered).not.toHaveBeenCalled();
    });

    it("未ログインには出さない（口が断るので押させない）", async () => {
        authState.current = { isAuthenticated: false, userId: null, loading: false };
        view();
        await openMenu();
        expect(screen.queryByRole("menuitem", { name: "この人をブロック" })).toBeNull();
    });
});
