import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";

/**
 * 🔴 **運営未確認の下書きを「確認済み」に見せない。**
 *
 * 2026-09-24 の台帳は AI が1日で書いた 1,417件に `verifiedAt` が付いていて、
 * 画面は全ページに「情報の最終確認: 2026-09-24」と描いていた。人は1件も
 * 確かめていない。ここで固定するのは4つ:
 *
 *  1. 下書きには帯（「下書き（運営未確認）」）が出る
 *  2. 下書きに「情報の最終確認」を出さない
 *  3. 下書きの公式サイトのリンクは「未確認」と名乗り、`nofollow` を付ける
 *  4. 人が確かめた行（published＋verifiedBy）だけ「情報の最終確認: …（運営）」
 */
const auth = vi.hoisted(() => ({ isAuthenticated: false, loading: false }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({ userFetch: fetchMock }));

vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotGuideClient from "../SpotGuideClient";

/** 運営未確認の下書き（確認者・確認日を持たない） */
const DRAFT: Spot = {
    spotId: "sp_takaya",
    slug: "takaya-jinja",
    name: "高屋神社",
    summary: "あ".repeat(40),
    region: { country: "日本", prefecture: "香川県", city: "観音寺市" },
    coords: { lat: 34.1, lng: 133.6 },
    highlights: ["雲海が出る朝がある"],
    officialWebsiteUrl: "https://example.example/",
    status: "review",
    draftedAt: "2026-09-24",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
};

/** 人が確かめた1件 */
const VERIFIED: Spot = {
    ...DRAFT,
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-09-25",
    draftedAt: undefined,
};

const view = (spot: Spot) => render(
    <ToastProvider>
        <SpotGuideClient spot={spot} photos={[]} nearby={[]} locationPath={null} />
    </ToastProvider>,
);

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ slugs: [] }) });
});

describe("下書き（運営未確認）の撮影地ガイド", () => {
    it("帯が出て、下書きを書いた日が入る", () => {
        view(DRAFT);
        const note = screen.getByRole("note");
        expect(note.textContent).toContain("下書き（運営未確認）");
        expect(note.textContent).toContain("下書き作成: 2026-09-24");
    });

    /// 🔴 日付が書いてあっても、確認者（verifiedBy）が無ければ描かない
    /// ——以前は `verifiedAt` があれば無条件に「情報の最終確認」と出ていた
    it("「情報の最終確認」を出さない（日付だけが残っていても）", () => {
        view({ ...DRAFT, verifiedAt: "2026-09-24" });
        expect(screen.queryByText(/情報の最終確認/)).toBeNull();
    });

    it("公式サイトのリンクは「未確認」と名乗り、nofollow を付ける", () => {
        view(DRAFT);
        const link = screen.getByRole("link", { name: /公式サイト（未確認のリンク）/ });
        expect(link.getAttribute("href")).toBe("https://example.example/");
        expect(link.getAttribute("rel")).toContain("nofollow");
    });
});

describe("人が確かめた撮影地ガイド", () => {
    it("帯は出ず、「情報の最終確認: 日付（運営）」が出る", () => {
        view(VERIFIED);
        expect(screen.queryByRole("note")).toBeNull();
        expect(screen.getByText("情報の最終確認: 2026-09-25（運営）")).toBeTruthy();
        const link = screen.getByRole("link", { name: /^公式サイト/ });
        expect(link.getAttribute("rel")).not.toContain("nofollow");
        expect(link.textContent).not.toContain("未確認");
    });
});

describe("AI 照合で公開した撮影地ガイド（owner の委任・2026-09-26）", () => {
    const AI_CHECKED: Spot = {
        ...DRAFT,
        status: "published",
        draftedAt: undefined,
        aiCheck: {
            checkedAt: "2026-09-26", delegatedBy: "rymaruta",
            sources: [{ url: "https://ja.wikipedia.org/wiki/%E9%AB%98%E5%B1%8B%E7%A5%9E%E7%A4%BE", title: "Wikipedia「高屋神社」" }],
        },
    };

    it("下書きの帯は出ず、出典と「AI 照合」を出す。「運営」とは名乗らない", () => {
        view(AI_CHECKED);
        expect(screen.queryByRole("note")).toBeNull();
        expect(screen.queryByText(/情報の最終確認/)).toBeNull();
        expect(screen.queryByText(/（運営）/)).toBeNull();
        const source = screen.getByRole("link", { name: "Wikipedia「高屋神社」" });
        expect(source.getAttribute("href")).toBe("https://ja.wikipedia.org/wiki/%E9%AB%98%E5%B1%8B%E7%A5%9E%E7%A4%BE");
        expect(screen.getByText(/AI 照合 2026-09-26/)).toBeTruthy();
    });
});
