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

    // **格子で3等分**（`flex-1` だと外箱で包んだ「行きたい」だけ 14px 狭くなった・実測 82/96/96）
    it("行動は3つ（行きたい・地図で見る・シェア）が格子の3等分に直接並ぶ。公式サイトはその列に入れない", async () => {
        view();
        const wish = await screen.findByRole("button", { name: "行きたい" });
        const map = screen.getByRole("link", { name: "地図で見る" });
        const shareBtn = screen.getByRole("button", { name: "シェア" });
        const row = map.parentElement!;
        expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(["grid", "grid-cols-3"]));
        // 3つとも格子の直接の子（外箱で包まない）・高さ48
        for (const el of [wish, map, shareBtn]) {
            expect(el.parentElement, el.textContent!).toBe(row);
            expect(el.style.minHeight, el.textContent!).toBe("48px");
            // 印は縮ませない（狭い列で幅0まで潰れた）
            expect(el.querySelector("svg")!.getAttribute("class"), el.textContent!).toContain("flex-shrink-0");
        }
        // PC は本文の列の幅で止める（スマホの形を横に引き伸ばさない）
        expect(row.className).toContain("max-w-xl");
        const site = screen.getByRole("link", { name: /公式サイト/ });
        expect(row.contains(site), "公式サイトが行動の列に入っている").toBe(false);
        // 本文（この場所の魅力）の後ろ
        expect(before(screen.getByRole("heading", { name: "この場所の魅力" }), site)).toBe(true);
    });

    it("未ログインの「行きたい」も格子の直接の子（ログインへのリンク）", () => {
        auth.isAuthenticated = false;
        try {
            view();
            const wish = screen.getByRole("link", { name: "行きたい" });
            expect(wish.parentElement).toBe(screen.getByRole("link", { name: "地図で見る" }).parentElement);
            expect(wish.style.minHeight).toBe("48px");
        } finally {
            auth.isAuthenticated = true;
        }
    });

    it("保存済みの「行きたい」は白地に墨の字（iOS の filled）", async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ slugs: ["SPOT-takaya-jinja"] }) });
        view();
        const saved = await screen.findByRole("button", { name: "保存済み" });
        expect(saved.className.split(/\s+/)).toEqual(expect.arrayContaining(["bg-primary", "text-ink"]));
        expect(saved.className).not.toMatch(/(^|\s)bg-surface(\s|$)/);
    });

    it("読み込みに失敗した断りは細い列ではなく行の下に1段で出す・再試行は押せる大きさ", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        view();
        const alert = await screen.findByRole("alert");
        expect(alert.className).toContain("col-span-3");
        expect(alert.parentElement).toBe(screen.getByRole("link", { name: "地図で見る" }).parentElement);
        expect(screen.getByRole("button", { name: "再試行" }).className).toContain("min-h-[44px]");
    });

    it("読み込み中も字は「行きたい」のまま（押せない・aria-busy）", () => {
        fetchMock.mockReturnValue(new Promise(() => {}));
        view();
        const wish = screen.getByRole("button", { name: "行きたい" });
        expect(wish).toHaveProperty("disabled", true);
        expect(wish.getAttribute("aria-busy")).toBe("true");
    });

    it("シェアはこのページの URL を配り、コピーに落ちたら知らせる", async () => {
        share.shareUrl.mockResolvedValue("copied");
        view();
        fireEvent.click(screen.getByRole("button", { name: "シェア" }));
        await waitFor(() => expect(share.shareUrl).toHaveBeenCalledWith(PAGE, "高屋神社", "香川県 観音寺市"));
        await waitFor(() => expect(toast.showToast).toHaveBeenCalledWith("リンクをクリップボードにコピーしました", "success"));
    });

    it("シェアに失敗したら知らせる・閉じただけなら何も出さない", async () => {
        share.shareUrl.mockResolvedValueOnce("failed");
        view();
        fireEvent.click(screen.getByRole("button", { name: "シェア" }));
        await waitFor(() => expect(toast.showToast).toHaveBeenCalledWith("共有できませんでした", "error"));
        toast.showToast.mockReset();
        share.shareUrl.mockResolvedValueOnce("cancelled");
        fireEvent.click(screen.getByRole("button", { name: "シェア" }));
        await waitFor(() => expect(share.shareUrl).toHaveBeenCalledTimes(2));
        await new Promise((r) => setTimeout(r, 0));
        expect(toast.showToast).not.toHaveBeenCalled();
    });

    it("地域が無ければ枚数だけ", () => {
        view({ ...SPOT, region: undefined } as Spot);
        expect(screen.getByText("0枚の写真")).toBeTruthy();
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
