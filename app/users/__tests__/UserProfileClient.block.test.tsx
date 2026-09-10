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
        await user.click(await screen.findByRole("menuitem", { name: "ブロックする" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        expect(blockCalls("POST")[0][0]).toBe(`/users/${OTHER}/block`);
    });

    // **何が起きるかを言う。** フォローが両向きに切れることは、押した人には
    // 見えない（相手の画面で数が減るだけ）
    it("フォローも外れることを伝える", async () => {
        view();
        const user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "ブロックする" }));
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
        await user.click(await screen.findByRole("menuitem", { name: "ブロックする" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        await user.click(await screen.findByRole("button", { name: /共有|Share/ }));
        expect(await screen.findByRole("menuitem", { name: "ブロックする" }), "効いていないのに解除と出ている").toBeInTheDocument();
    });

    it("押し直すと解除できる", async () => {
        view();
        let user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "ブロックする" }));
        await waitFor(() => expect(blockCalls("POST")).toHaveLength(1));
        user = await openMenu();
        await user.click(await screen.findByRole("menuitem", { name: "ブロックを解除" }));
        await waitFor(() => expect(blockCalls("DELETE")).toHaveLength(1));
    });

    it("未ログインには出さない（口が断るので押させない）", async () => {
        authState.current = { isAuthenticated: false, userId: null, loading: false };
        view();
        await openMenu();
        expect(screen.queryByRole("menuitem", { name: "ブロックする" })).toBeNull();
    });
});
