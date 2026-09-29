import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";
import type { Photo } from "@/lib/data/photos";

/**
 * 撮影スポットのページを iOS の `OfficialSpotView`（板 13）に揃えたところ（2026-09-29）。
 *
 *  - 小見出し（公開は「撮影スポット」・下書きは「下書き・未確認」）
 *  - 「[地域] · N枚の写真」
 *  - 行動3つ（行きたい・地図で見る・シェア）が横に等分
 *  - 写真がある場所は写真の節が本文より先・0枚は本文の後ろ
 *  - 公式サイトは行動の列ではなく本文の後ろ
 */
const auth = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({ userFetch: fetchMock }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));
const share = vi.hoisted(() => ({ shareUrl: vi.fn() }));
vi.mock("@/lib/utils/share", () => share);
// 知らせは `ToastProvider` が描かないので、呼ばれた文で見る
const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("@/lib/hooks/useToast", async (orig) => ({ ...(await orig<object>()), useToast: () => toast }));
vi.mock("../../../lib/hooks/useToast", async (orig) => ({ ...(await orig<object>()), useToast: () => toast }));

import SpotGuideClient from "../SpotGuideClient";

const SPOT: Spot = {
    spotId: "sp_takaya",
    slug: "takaya-jinja",
    name: "高屋神社",
    summary: "あ".repeat(40),
    description: "雲海に浮かぶ鳥居",
    region: { country: "日本", prefecture: "香川県", city: "観音寺市" },
    coords: { lat: 34.1, lng: 133.6 },
    highlights: ["雲海が出る朝がある"],
    officialWebsiteUrl: "https://example.example/",
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-09-23",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
};
const PHOTO = { id: "p1", src: "https://cdn/p1.jpg", title: "t" } as Photo;
const PAGE = "https://journey-photo.com/spots/takaya-jinja";

const view = (spot: Spot = SPOT, photos: Photo[] = []) => render(
    <ToastProvider>
        <SpotGuideClient spot={spot} photos={photos} nearby={[]} locationPath={null} pageUrl={PAGE} />
    </ToastProvider>,
);

/** 文書の並びで a が b より前か */
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ slugs: [] }) });
    share.shareUrl.mockReset();
    toast.showToast.mockReset();
});

/** 小見出し（見出しの上の等幅の1行）。パンくずの「撮影スポット」と取り違えない */
const eyebrow = () => document.querySelector("header p.font-mono")?.textContent;

describe("撮影スポットのページ（iOS の板 13 に揃えた形）", () => {
    it("小見出しは公開なら「撮影スポット」、下書きなら「下書き・未確認」（下書きを撮影スポットと名乗らない）", () => {
        const { unmount } = view();
        expect(eyebrow()).toBe("撮影スポット");
        expect(document.querySelector("header p.font-mono")!.className).toContain("text-accent");
        unmount();
        view({ ...SPOT, status: "review", verifiedBy: undefined, verifiedAt: undefined } as Spot);
        expect(eyebrow()).toBe("下書き・未確認");
        expect(document.querySelector("header p.font-mono")!.className).not.toContain("text-accent");
    });

    it("見出しの下は「地域 · N枚の写真」（数えた枚数）", () => {
        const { unmount } = view();
        expect(screen.getByText("香川県 観音寺市 · 0枚の写真")).toBeTruthy();
        unmount();
        view(SPOT, [PHOTO]);
        expect(screen.getByText("香川県 観音寺市 · 1枚の写真")).toBeTruthy();
    });

    it("行動は3つ（行きたい・地図で見る・シェア）で横に等分。公式サイトはその列に入れない", async () => {
        view();
        const wish = await screen.findByRole("button", { name: "行きたい" });
        const map = screen.getByRole("link", { name: "地図で見る" });
        const shareBtn = screen.getByRole("button", { name: "シェア" });
        const row = map.parentElement!;
        expect(shareBtn.parentElement).toBe(row);
        // 行きたいは失敗の断りを下に出す箱に入っている（箱ごと等分）
        expect(wish.closest("div")!.parentElement).toBe(row);
        for (const el of [wish.closest("div")!, map, shareBtn]) expect(el.className).toContain("flex-1");
        expect(map.style.minHeight).toBe("48px");
        const site = screen.getByRole("link", { name: /公式サイト/ });
        expect(row.contains(site), "公式サイトが行動の列に入っている").toBe(false);
        // 本文（この場所の魅力）の後ろ
        expect(before(screen.getByRole("heading", { name: "この場所の魅力" }), site)).toBe(true);
    });

    it("シェアはこのページの URL を配り、コピーに落ちたら知らせる", async () => {
        share.shareUrl.mockResolvedValue("copied");
        view();
        fireEvent.click(screen.getByRole("button", { name: "シェア" }));
        await waitFor(() => expect(share.shareUrl).toHaveBeenCalledWith(PAGE, "高屋神社", "香川県 観音寺市"));
        await waitFor(() => expect(toast.showToast).toHaveBeenCalledWith("リンクをクリップボードにコピーしました", "success"));
    });

    it("写真がある場所は写真の節が本文より先（写真が主役）", () => {
        view(SPOT, [PHOTO]);
        const photos = screen.getByRole("heading", { name: "この場所の写真（1）" });
        expect(before(photos, screen.getByRole("heading", { name: "この場所の魅力" }))).toBe(true);
    });

    it("写真が0枚の場所は本文の後ろ（1画面目を空の節にしない）", () => {
        view();
        const photos = screen.getByRole("heading", { name: "この場所の写真（0）" });
        expect(before(screen.getByRole("heading", { name: "この場所の魅力" }), photos)).toBe(true);
        expect(screen.getByRole("link", { name: "ここで撮った写真を投稿する" })).toBeTruthy();
    });
});
