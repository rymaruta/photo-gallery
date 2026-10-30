import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Spot } from "@/lib/data/spots";

/**
 * **撮影スポットの切り口の頁（国・テーマ・季節）とその入口**（2026-10-11）。
 * 頁の中身の組み立ては `lib/data/__tests__/spotTopics.test.ts`。ここは描いた形を見る。
 */
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ slugs: [] }) }) }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotTopicPage from "../SpotTopicPage";
import SpotsEntry from "../SpotsEntry";
import SpotGuideClient from "../SpotGuideClient";
import { ToastProvider } from "../../../lib/hooks/useToast";
import { themeView, countryView } from "@/lib/data/spotTopics";
import SpotAreaPage from "../../spots/area/[area]/page";
import SpotIndexPage from "../../spots/page";

const ldOf = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('script[type="application/ld+json"]')).map((s) => JSON.parse(s.textContent ?? "{}"));

describe("SpotTopicPage", () => {
    it("パンくず・見出し・導入文・カード（スポットの頁へ）・構造化データ2本", () => {
        const view = themeView("temples-shrines", "kyoto")!;
        const { container } = render(<SpotTopicPage view={view} eyebrow="Photo spots · Theme" />);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("京都府の寺社の撮影スポット");
        const crumbs = within(screen.getByRole("navigation", { name: "パンくずリスト" })).getAllByRole("link").map((a) => a.getAttribute("href"));
        expect(crumbs).toEqual(["/", "/spots", "/spots/area/kyoto"]);
        expect(screen.getByText(view.intro)).toBeTruthy();
        const cards = container.querySelectorAll("ul.grid > li > div > a");
        expect(cards).toHaveLength(view.cards.length);
        expect(cards[0].getAttribute("href")).toBe(`/spots/${view.cards[0].slug}`);
        const ld = ldOf(container);
        expect(ld.map((x) => x["@type"])).toEqual(["BreadcrumbList", "ItemList"]);
        expect(ld[1].numberOfItems).toBe(view.cards.length);
    });

    it("写真のクレジットはカードの下に文字で出る（CC BY 系）", () => {
        const view = themeView("temples-shrines", "kinki")!;
        render(<SpotTopicPage view={view} eyebrow="x" />);
        const credited = view.cards.find((c) => c.cover?.credit?.license && c.cover.credit.licenseUrl)!;
        const cr = credited.cover!.credit!;
        // スポットの頁と同じ形: 「写真: 作者 / ライセンス（文面へ）/ Wikimedia Commons（出典へ）」。カードのリンクの外
        const line = screen.getAllByTestId("topic-credit").find((el) => el.textContent?.startsWith(`写真: ${cr.author} / ${cr.license}`))!;
        expect(line).toBeTruthy();
        const lic = within(line).getByRole("link", { name: cr.license });
        expect(lic.getAttribute("href")).toBe(cr.licenseUrl);
        expect(lic.getAttribute("rel")).toContain("license");
        expect(line.closest("a")).toBeNull();
        expect(line.className).not.toContain("truncate");
    });

    it("🔴 `/spots/area/overseas` は国の一覧（スポットのカードを積まない）", async () => {
        const el = await SpotAreaPage({ params: Promise.resolve({ area: "overseas" }) });
        const { container } = render(el);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("海外の撮影スポット");
        expect(container.querySelectorAll("ul.grid")).toHaveLength(0);
        const fr = container.querySelector('a[href="/spots/area/overseas/fr"]');
        expect(fr?.textContent).toContain(String(countryView("fr")!.cards.length));
        // 県の頁はこれまでどおりスポットの一覧
        render(await SpotAreaPage({ params: Promise.resolve({ area: "kyoto" }) }));
        expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toContain("京都府の撮影スポット");
    });

    it("`/spots` から季節とテーマの頁へ張る", () => {
        const { container } = render(<SpotIndexPage />);
        const section = within(screen.getByTestId("spots-topic-index"));
        expect(section.getByRole("link", { name: /^秋の撮影スポット/ }).getAttribute("href")).toBe("/spots/season/autumn");
        expect(container.querySelector('a[href="/spots/theme/temples-shrines/kyoto"]')).toBeTruthy();
    });
});

describe("英語表示・チップの当たり", () => {
    it("枠（パンくず・見出し・関連の見出し・チップ）は英語に切り替わる。導入文は日本語のまま", async () => {
        const ctx = await import("../../i18n/context");
        const spy = vi.spyOn(ctx, "useLocale").mockReturnValue({ locale: "en", labels: {} } as never);
        try {
            const view = themeView("temples-shrines", "kyoto")!;
            render(<SpotTopicPage view={view} eyebrow="x" />);
            expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Temples & shrines photo spots in Kyoto");
            const crumbs = within(screen.getByRole("navigation")).getAllByRole("link").map((a) => a.textContent);
            expect(crumbs).toEqual(["Home", "Photo spots", "Kyoto"]);
            expect(screen.getByRole("heading", { name: "Temples & shrines in other areas" })).toBeTruthy();
            expect(screen.getByText(view.intro)).toBeTruthy();
        } finally {
            spy.mockRestore();
        }
    });

    it("チップは見た目 34px のまま、当たりを上下 5px 広げて 44px（行の隙間は 10px）", () => {
        render(<SpotTopicPage view={themeView("temples-shrines", "kyoto")!} eyebrow="x" />);
        const chip = screen.getByRole("link", { name: /^近畿地方（関西）の寺社/ });
        expect(chip.style.minHeight).toBe("34px");
        expect(chip.className).toContain("before:-inset-y-[5px]");
        expect(chip.className).toContain("relative");
        expect(chip.closest("ul")!.className).toContain("gap-y-2.5");
    });
});

describe("SpotsEntry（ホーム）", () => {
    const seasonal = {
        season: "autumn" as const, href: "/spots/season/autumn", total: 194,
        spots: [{
            slug: "a", name: "A寺", region: "京都府 京都市", src: "/images/spots/thumb/a.jpg", alt: "A寺",
            credit: { author: "Someone with a very long name indeed", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", sourceUrl: "https://commons.wikimedia.org/wiki/File:A.jpg" },
        }],
    };

    it("1行の入口のあとに、いまの季節のスポットを写真つきで並べる", () => {
        render(<SpotsEntry locale="ja" seasonal={seasonal} />);
        expect(screen.getByTestId("home-spots-entry").getAttribute("href")).toBe("/spots");
        const sec = within(screen.getByTestId("home-season-spots"));
        expect(sec.getByRole("heading").textContent).toBe("いまの季節（秋）の撮影スポット");
        expect(sec.getByRole("link", { name: /すべて 194件/ }).getAttribute("href")).toBe("/spots/season/autumn");
        const card = sec.getByRole("link", { name: /A寺/ });
        expect(card.getAttribute("href")).toBe("/spots/a");
        expect(card.querySelector("img")?.getAttribute("src")).toBe("/images/spots/thumb/a.jpg");
        // ライセンスの行が先で切らない・文面へのリンク。作者の行だけ切る（全文は title）
        const credit = sec.getByTestId("topic-credit");
        const [licLine, authorLine] = Array.from(credit.querySelectorAll("p"));
        expect(licLine.className).not.toContain("truncate");
        expect(within(licLine).getByRole("link", { name: "CC BY-SA 4.0" }).getAttribute("href")).toBe("https://creativecommons.org/licenses/by-sa/4.0");
        // 出典（Commons のページ）へは作者の行がリンクする
        expect(within(authorLine).getByRole("link").getAttribute("href")).toBe("https://commons.wikimedia.org/wiki/File:A.jpg");
        expect(authorLine.textContent).toBe("写真: Someone with a very long name indeed");
        expect(authorLine.getAttribute("title")).toBe("Someone with a very long name indeed");
        expect(credit.closest("a")).toBeNull();
    });

    it("🔴 ホームを押し下げすぎない: 見出しの行を置かず、写真の札は 80px", () => {
        const { container } = render(<SpotsEntry locale="ja" seasonal={seasonal} />);
        const sec = screen.getByTestId("home-season-spots");
        expect(sec.querySelector("h2")?.className).toContain("sr-only");
        const cards = Array.from(sec.querySelectorAll("li > a")) as HTMLElement[];
        for (const a of cards) expect(a.style.height).toBe("80px");
        void container;
    });

    it("選べるスポットが無ければ1行だけ", () => {
        render(<SpotsEntry locale="ja" seasonal={null} />);
        expect(screen.getByTestId("home-spots-entry")).toBeTruthy();
        expect(screen.queryByTestId("home-season-spots")).toBeNull();
    });
});

describe("スポットの頁 → 切り口の頁", () => {
    const SPOT: Spot = {
        spotId: "sp_kinkaku0001", slug: "kinkakuji", name: "鹿苑寺（金閣寺）", summary: "あ".repeat(40),
        region: { country: "日本", prefecture: "京都府", city: "京都市" }, coords: { lat: 35.04, lng: 135.73 },
        status: "published", verifiedBy: "運営", verifiedAt: "2026-09-23",
        createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
    };

    it("載っている一覧へのチップを出す（無ければ節ごと出さない）", () => {
        const topics = [{ href: "/spots/theme/temples-shrines/kyoto", label: "京都府の寺社の撮影スポット", count: 14 }];
        const { unmount } = render(<ToastProvider><SpotGuideClient spot={SPOT} photos={[]} nearby={[]} locationPath={null} topics={topics} /></ToastProvider>);
        const sec = within(screen.getByTestId("spot-topics"));
        expect(sec.getByRole("heading").textContent).toBe("この撮影スポットが載っている一覧");
        expect(sec.getByRole("link", { name: /京都府の寺社の撮影スポット/ }).getAttribute("href")).toBe("/spots/theme/temples-shrines/kyoto");
        unmount();
        render(<ToastProvider><SpotGuideClient spot={SPOT} photos={[]} nearby={[]} locationPath={null} /></ToastProvider>);
        expect(screen.queryByTestId("spot-topics")).toBeNull();
    });

    it("🔴 海外のスポットは パンくずに国を入れ、「すべて見る」は国の頁へ（国の一覧の頁へ飛ばさない）", async () => {
        const { SPOTS } = await import("@/lib/data/spots");
        const { spotCountryRef } = await import("@/lib/data/spotTopics");
        const { spotBreadcrumb } = await import("@/lib/data/spotSeo");
        const fr = SPOTS.find((x) => x.region?.country === "フランス" && x.status === "published")!;
        const country = spotCountryRef(fr)!;
        expect(country).toEqual({ href: "/spots/area/overseas/fr", name: "フランス", nameEn: "France" });
        expect(spotBreadcrumb(fr, { slug: "overseas", name: "海外", nameEn: "Outside Japan" } as never, country).map((c) => c.name))
            .toEqual(["ホーム", "撮影スポット", "海外", "フランス", fr.name]);
        const OVERSEAS: Spot = { ...SPOT, region: { country: "フランス", prefecture: "イル・ド・フランス" } };
        render(<ToastProvider><SpotGuideClient spot={OVERSEAS} photos={[]} nearby={[]} locationPath={null}
            area={{ slug: "overseas", name: "海外", nameEn: "Outside Japan" }} country={country}
            sameArea={{ label: "フランス", spots: [{ slug: "x", name: "X", region: "パリ" } as never] }} /></ToastProvider>);
        const crumbs = within(screen.getByRole("navigation", { name: "パンくずリスト" })).getAllByRole("link").map((a) => a.getAttribute("href"));
        expect(crumbs).toEqual(["/", "/spots", "/spots/area/overseas", "/spots/area/overseas/fr"]);
        expect(screen.getByRole("link", { name: /フランスの撮影スポットをすべて見る/ }).getAttribute("href")).toBe("/spots/area/overseas/fr");
        expect(screen.queryByRole("link", { name: /海外の撮影スポットをすべて見る/ })).toBeNull();
    });
});
