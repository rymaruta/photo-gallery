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
const mockResetFollowing = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/hooks/useFollow", async (importActual) => ({
    ...(await importActual<typeof import("../../../lib/hooks/useFollow")>()),
    resetFollowingCache: () => mockResetFollowing(),
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
    mockResetFollowing.mockReset();
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

    // **何が起きるかを言う。** フォローが両向きに切れることは、押した人には
    // 見えない（相手の画面で数が減るだけ）
    it("フォローも外れることを伝える", async () => {
        view();
        const user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "この人をブロック" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(mockShowToast.mock.calls[0][0]).toContain("フォローも外れました");
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

    // **同じ画面のフォローの状態も捨てる。** 捨てないと、トーストが
    // 「お互いのフォローも外れました」と言った直後に、すぐ下のボタンが
    // 「フォロー中」のまま残る（共有ストアはログイン・ログアウトでしか
    // 捨てない）。コミットに「押した人には見えない」と書いたのは誤りで、
    // 実際には**押した人の画面が間違った状態で見えていた**
    it("ブロックしたら、フォローの控えを捨てる", async () => {
        view();
        const user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "この人をブロック" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        expect(mockResetFollowing, "フォローの状態が古いまま残る").toHaveBeenCalled();
    });

    it("失敗した回は捨てない（取り直しを無駄に増やさない）", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (String(url).includes("/block")) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view();
        const user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "この人をブロック" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        expect(mockResetFollowing).not.toHaveBeenCalled();
    });

    it("未ログインには出さない（口が断るので押させない）", async () => {
        authState.current = { isAuthenticated: false, userId: null, loading: false };
        view();
        await openMenu();
        expect(screen.queryByRole("menuitem", { name: "この人をブロック" })).toBeNull();
    });
});
