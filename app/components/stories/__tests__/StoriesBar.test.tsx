import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// 認証状態を切り替えられるモック
const authState = vi.hoisted(() => ({ current: { isAuthenticated: false, userId: null as string | null } }));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// /stories 取得（ユーザーAPI）をモック
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));

import StoriesBar from "../StoriesBar";

beforeEach(() => {
    authState.current = { isAuthenticated: false, userId: null };
    mockUserFetch.mockReset();
    mockUserFetch.mockResolvedValue({ ok: true, json: async () => [] });
});

describe("StoriesBar - ログイン限定", () => {
    it("未ログインでは何も描画せず、ストーリーも取得しない", async () => {
        const { container } = render(<StoriesBar />);
        expect(container.firstChild).toBeNull();
        // 少し待っても取得は走らない
        await new Promise((r) => setTimeout(r, 20));
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("ログイン時は自分の投稿ボタンを表示し、/stories を認証付きで取得する", async () => {
        authState.current = { isAuthenticated: true, userId: "me" };
        render(<StoriesBar />);
        // 「あなた」= 自分のストーリー追加ボタン
        expect(await screen.findByText("あなた")).toBeInTheDocument();
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/stories"));
    });

    it("取得したストーリーのユーザーがリングとして並ぶ", async () => {
        authState.current = { isAuthenticated: true, userId: "me" };
        mockUserFetch.mockResolvedValue({
            ok: true,
            json: async () => [
                { id: "s1", src: "https://cdn/a.jpg", userId: "u2", displayName: "旅人A", createdAt: "2098-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" },
            ],
        });
        render(<StoriesBar />);
        expect(await screen.findByText("旅人A")).toBeInTheDocument();
    });
});

// 取得の失敗がバー空表示（誰も投稿していない見た目）と区別できなかった（SW-b5）
describe("StoriesBar - 一覧の取得失敗", () => {
    it("失敗を伝えて、再試行で立て直す", async () => {
        authState.current = { isAuthenticated: true, userId: "me" };
        mockUserFetch
            .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
            .mockResolvedValueOnce({ ok: true, json: async () => [
                { id: "s1", src: "https://cdn/a.jpg", userId: "u2", displayName: "旅人A", createdAt: "2098-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" },
            ] });
        render(<StoriesBar />);

        expect(await screen.findByText(/ストーリーを読み込めませんでした/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "再試行" }));
        expect(await screen.findByText("旅人A")).toBeInTheDocument();
        expect(screen.queryByText(/読み込めませんでした/)).toBeNull();
    });
});

// 成功時の setLoadError(false) が消えても通っていた（レビューの変異で実証）。
// 空配列の成功（全ストーリー期限切れ）でもエラー行を復活させない。
describe("StoriesBar - 再試行が空配列で成功", () => {
    it("成功ならエラー行は出ない（0件でも）", async () => {
        authState.current = { isAuthenticated: true, userId: "me" };
        mockUserFetch
            .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
            .mockResolvedValueOnce({ ok: true, json: async () => [] });
        render(<StoriesBar />);

        expect(await screen.findByText(/ストーリーを読み込めませんでした/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "再試行" }));
        await waitFor(() => expect(screen.queryByText(/読み込めませんでした/)).toBeNull());
    });
});

// 別タブで先に消した／24時間で期限切れになったストーリーを消すと 404。
// 失敗と読んで throw していたので loadStories() に到達せず、**もう存在
// しないストーリーがバーに残り続けた**（開くと画像が取れない）。CT-5。
describe("StoriesBar - 削除したら 404 だった", () => {
    it("成功として扱い、一覧を取り直す（消えたものがバーに残らない）", async () => {
        authState.current = { isAuthenticated: true, userId: "me" };
        const mine = {
            id: "s1", src: "https://cdn/a.jpg", userId: "me", displayName: "自分",
            createdAt: "2098-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z",
        };
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "DELETE") {
                // 別タブが先に消していた
                return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "ストーリーが見つかりません" }) });
            }
            if (url === "/stories") {
                // 削除を投げたあとの取り直しでは、もう無い
                const deleted = mockUserFetch.mock.calls.some(
                    (c) => (c[1] as { method?: string } | undefined)?.method === "DELETE");
                return Promise.resolve({ ok: true, json: async () => (deleted ? [] : [mine]) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<StoriesBar />);
        // 自分のストーリーを開く
        fireEvent.click(await screen.findByRole("button", { name: "自分のストーリーを見る" }));
        // 削除 → 確認
        fireEvent.click(await screen.findByRole("button", { name: "ストーリーを削除" }));
        fireEvent.click(await screen.findByRole("button", { name: "削除" }));

        // 取り直しに到達している（throw していたら来ない）
        await waitFor(() => {
            const listCalls = mockUserFetch.mock.calls.filter(
                (c) => c[0] === "/stories" && (c[1] as { method?: string } | undefined)?.method !== "DELETE");
            expect(listCalls.length).toBeGreaterThan(1);
        });
    });
});
