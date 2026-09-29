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

    it("公開の小見出しは読み上げから外し（パンくずと同じ語）、下書きの「下書き・未確認」は読ませる", () => {
        const { unmount } = view();
        expect(document.querySelector("header p.font-mono")!.getAttribute("aria-hidden")).toBe("true");
        unmount();
        view({ ...SPOT, status: "review", verifiedBy: undefined, verifiedAt: undefined } as Spot);
        expect(document.querySelector("header p.font-mono")!.hasAttribute("aria-hidden")).toBe(false);
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
        // 格子は前の空きへ戻らない。後ろへ回さないと地図とシェアが3段目へ落ちる（Chromium 実測）。
        // **語で完全一致を見る**（部分一致だと `sm:order-last` や綴り違いを通す）
        expect(alert.className.split(/\s+/)).toEqual(expect.arrayContaining(["col-span-3", "order-last"]));
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

    // iOS の `heroPhoto`: スマホは 4:3、出典は写真の下（写真に重ねて暗くしない）
    it("代表写真はスマホで 4:3、出典は写真の箱の外（下）に出し、写真を暗くする幕を掛けない", () => {
        view({
            ...SPOT,
            coverImage: {
                src: "/images/spots/takaya-jinja.jpg", alt: "高屋神社", aspectRatio: 1.5,
                credit: "Someone", license: "cc-by-sa",
                sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
                licenseLabel: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
                checkedAt: "2026-09-26", verifiedPlace: true,
            },
        } as Spot);
        const box = screen.getByRole("img", { name: "高屋神社" }).parentElement!;
        expect(box.className.split(/\s+/)).toEqual(expect.arrayContaining(["aspect-[4/3]", "sm:aspect-[12/5]"]));
        const credit = screen.getByRole("link", { name: "Wikimedia Commons" }).closest("p")!;
        expect(box.contains(credit), "出典が写真に重なっている").toBe(false);
        expect(before(box, credit)).toBe(true);
        // 写真の箱の中は写真だけ（幕の書き方は `bg-gradient-*` も `bg-linear-*` もあるので、クラスでなく中身で見る）
        expect(Array.from(box.children).map((c) => c.tagName), "写真の上に何か重なっている").toEqual(["IMG"]);
        // 出典の行は本文の列と同じ箱（最大幅まで・1152px を超えると外れた）
        expect(credit.className.split(/\s+/)).toEqual(expect.arrayContaining(["mx-auto", "max-w-5xl", "lg:max-w-6xl"]));
    });

    it("ほかのスポットの行は面の箱に、名前・距離・矢印（距離は iOS と同じ刻み）", () => {
        render(
            <ToastProvider>
                <SpotGuideClient spot={SPOT} photos={[]} nearby={[]} locationPath={null} pageUrl={PAGE}
                    area={{ slug: "kagawa", name: "香川県", nameEn: "Kagawa" }}
                    sameArea={{ label: "香川県", spots: [
                        { slug: "a", name: "父母ヶ浜", region: "香川県 三豊市", km: 12.4 },
                        { slug: "b", name: "銭形砂絵", region: "香川県 観音寺市", km: 0.4 },
                        { slug: "c", name: "座標なし", region: "香川県" },
                    ] }} />
            </ToastProvider>,
        );
        const list = screen.getByRole("heading", { name: "香川県の撮影スポット" }).nextElementSibling!;
        expect(list.tagName).toBe("UL");
        expect(list.className.split(/\s+/)).toEqual(expect.arrayContaining(["bg-surface", "rounded-2xl"]));
        const rows = Array.from(list.querySelectorAll("a"));
        expect(rows.map((a) => a.getAttribute("href"))).toEqual(["/spots/a", "/spots/b", "/spots/c"]);
        expect(rows[0].textContent).toContain("約12km");
        expect(rows[1].textContent).toContain("1km以内");
        // 座標が無い行は距離を出さない（`NaNkm` を出さない）
        expect(rows[2].textContent).not.toMatch(/km/);
        for (const a of rows) {
            expect(a.style.minHeight).toBe("54px");
            expect(a.querySelectorAll("svg")).toHaveLength(2);   // 印と矢印
        }
    });
});
