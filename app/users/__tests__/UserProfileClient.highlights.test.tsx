import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

/**
 * マイページのハイライトの輪（⑦）の置き場所。
 *
 * ストーリーのバー（本人だけ）と違って、**誰のページでも、誰にでも出る**
 * ——アーカイブから束ねて見せるのがハイライトの役目。0件なら訪問者には
 * 何も描かない（本人には「新規」）。
 */
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/users/x" }));
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
const H1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
import UserProfileClient from "../UserProfileClient";

const publicApi = () => async () => ({ ok: true, status: 200, json: async () => ({ userId: OWNER, displayName: "旅人" }) });
/** ハイライトは `userFetch`（ログインが要る口）で引く */
const withHighlights = (highlights: unknown[]) => async (url: string) => {
    if (String(url).startsWith("/highlights/")) return { ok: true, status: 200, json: async () => ({ highlights }) };
    return { ok: true, json: async () => [] };
};

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation(withHighlights([{ id: H1, title: "北海道", count: 1, cover: null }]));
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset().mockImplementation(publicApi());
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
    document.body.innerHTML = "";
});

describe("マイページのハイライト", () => {
    // 🔴 **未ログインには出さない。** 中身はストーリーそのもので、一覧
    // （`GET /stories`）は認証必須——ここだけインターネットに開かない
    it("未ログインの訪問者には出ない（取りにもいかない）", async () => {
        render(<UserProfileClient userId={OWNER} />);
        expect(await screen.findByText("旅人")).toBeInTheDocument();
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(screen.queryByTestId("highlights-row")).toBeNull();
        expect(mockUserFetch.mock.calls.some((c) => String(c[0]).startsWith("/highlights/")),
            "ログインしていないのに取りにいっている").toBe(false);
    });

    it("ログインした訪問者のページには出る", async () => {
        mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: "22222222-2222-4222-8222-222222222222" } }) });
        render(<UserProfileClient userId={OWNER} />);
        expect(await screen.findByRole("button", { name: "ハイライト「北海道」を見る" })).toBeInTheDocument();
        expect(mockUserFetch).toHaveBeenCalledWith(`/highlights/${OWNER}`);
        // 他人なので「新規」は無い
        expect(screen.queryByRole("link", { name: "ハイライトを作る" })).toBeNull();
    });

    it("0件ならログインした訪問者にも何も描かない", async () => {
        mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: "22222222-2222-4222-8222-222222222222" } }) });
        mockUserFetch.mockImplementation(withHighlights([]));
        render(<UserProfileClient userId={OWNER} />);
        expect(await screen.findByText("旅人")).toBeInTheDocument();
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(screen.queryByTestId("highlights-row")).toBeNull();
    });

    // PM:「マイページの輪＝アーカイブの入口もここ」。輪はハイライトで、
    // アーカイブ（本人だけのもの）は輪にせず、下書きの隣に入口を置く
    it("本人にはアーカイブへの入口が出る（訪問者には出ない）", async () => {
        mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: OWNER } }) });
        render(<UserProfileClient userId={OWNER} />);
        const link = await screen.findByRole("link", { name: "アーカイブ →" });
        expect(link.getAttribute("href")).toBe("/user/archive");
    });

    it("訪問者にアーカイブへの入口は出ない", async () => {
        render(<UserProfileClient userId={OWNER} />);
        expect(await screen.findByText("旅人")).toBeInTheDocument();
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(screen.queryByRole("link", { name: "アーカイブ →" })).toBeNull();
    });

    it("本人には0件でも「新規」が出る", async () => {
        mockUserFetch.mockImplementation(withHighlights([]));
        mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: OWNER } }) });
        render(<UserProfileClient userId={OWNER} />);
        const add = await screen.findByRole("link", { name: "ハイライトを作る" });
        expect(add.getAttribute("href")).toBe("/user/highlights");
        await waitFor(() => expect(screen.getByTestId("highlights-row")).toBeInTheDocument());
    });
});
