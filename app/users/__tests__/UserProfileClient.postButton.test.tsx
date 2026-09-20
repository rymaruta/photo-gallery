import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * マイページの「投稿する」。
 *
 * owner:「写真を追加のとこで投稿かストーリーを選べるようにしたい。それに加えて、
 * 写真を追加という表現で良いかわからないのでそこも考慮して」
 *
 * - 押すと `PostSheet`（写真／ストーリーの2択）。**「＋」と同じ部品**
 * - 文言は「写真を追加」をやめる——2択が出るのに写真だけを名乗ると嘘になる。
 *   語は画面の他と揃える（シートの見出しも「＋」の読み上げ名も「投稿する」）
 */
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }), usePathname: () => "/users/x" }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/auth/cognito", () => {
    const getCurrentSession = mockGetCurrentSession;
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        ...actual,
        publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../data/photos.json", () => ({ default: [] }));

const OWNER = "33333333-3333-4333-8333-333333333333";
import UserProfileClient from "../UserProfileClient";

const asOwner = () =>
    mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: OWNER } }) });

beforeEach(() => {
    mockPush.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }) });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
    document.body.innerHTML = "";
});

const postButton = () => screen.findByRole("button", { name: /投稿する/ });

describe("マイページの「投稿する」", () => {
    it("本人に出て、押すと写真／ストーリーの2択が開く", async () => {
        asOwner();
        render(<UserProfileClient userId={OWNER} />);
        const btn = await postButton();
        // **「写真を追加」とは名乗らない**（ストーリーも選べるので）
        expect(screen.queryByText("写真を追加"), "2択が出るのに写真だけを名乗っている").toBeNull();
        expect(screen.queryByRole("dialog", { name: "投稿する" }), "押す前から開いている").toBeNull();

        fireEvent.click(btn);
        const sheet = screen.getByRole("dialog", { name: "投稿する" });
        expect(sheet).toBeInTheDocument();
        expect(btn).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("button", { name: /写真を投稿/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /ストーリーを投稿/ })).toBeInTheDocument();
    });

    it("「写真を投稿」でアップロード画面へ（シートは閉じる）", async () => {
        asOwner();
        render(<UserProfileClient userId={OWNER} />);
        fireEvent.click(await postButton());
        fireEvent.click(screen.getByRole("button", { name: /写真を投稿/ }));
        expect(mockPush).toHaveBeenCalledWith("/user/upload");
        expect(screen.queryByRole("dialog", { name: "投稿する" })).toBeNull();
    });

    it("閉じるとフォーカスはボタンへ戻る", async () => {
        asOwner();
        render(<UserProfileClient userId={OWNER} />);
        const btn = await postButton();
        fireEvent.click(btn);
        fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
        expect(screen.queryByRole("dialog", { name: "投稿する" })).toBeNull();
        expect(document.activeElement).toBe(btn);
    });

    it("訪問者には出ない（他人のページに投稿の入口を置かない）", async () => {
        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(mockUserPublicFetch).toHaveBeenCalled());
        expect(screen.queryByRole("button", { name: /投稿する/ })).toBeNull();
    });
});
