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
        const cards = container.querySelectorAll("ul.grid > li a");
        expect(cards).toHaveLength(view.cards.length);
        expect(cards[0].getAttribute("href")).toBe(`/spots/${view.cards[0].slug}`);
        const ld = ldOf(container);
        expect(ld.map((x) => x["@type"])).toEqual(["BreadcrumbList", "ItemList"]);
        expect(ld[1].numberOfItems).toBe(view.cards.length);
    });

    it("写真のクレジットはカードの下に文字で出る（CC BY 系）", () => {
        const view = themeView("temples-shrines", "kinki")!;
        render(<SpotTopicPage view={view} eyebrow="x" />);
        const credited = view.cards.find((c) => c.cover?.credit)!;
        expect(screen.getAllByText(`写真: ${credited.cover!.credit}`).length).toBeGreaterThan(0);
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

describe("SpotsEntry（ホーム）", () => {
    const seasonal = {
        season: "autumn" as const, href: "/spots/season/autumn", total: 194,
        spots: [{ slug: "a", name: "A寺", region: "京都府 京都市", src: "/images/spots/thumb/a.jpg", alt: "A寺", credit: "Someone · CC BY-SA 4.0" }],
    };

    it("1行の入口のあとに、いまの季節のスポットを写真つきで並べる", () => {
        render(<SpotsEntry locale="ja" seasonal={seasonal} />);
        expect(screen.getByTestId("home-spots-entry").getAttribute("href")).toBe("/spots");
        const sec = within(screen.getByTestId("home-season-spots"));
        expect(sec.getByRole("heading").textContent).toBe("いまの季節（秋）の撮影スポット");
        expect(sec.getByRole("link", { name: /すべて見る（194件）/ }).getAttribute("href")).toBe("/spots/season/autumn");
        const card = sec.getByRole("link", { name: /A寺/ });
        expect(card.getAttribute("href")).toBe("/spots/a");
        expect(card.querySelector("img")?.getAttribute("src")).toBe("/images/spots/thumb/a.jpg");
        expect(sec.getByText("写真: Someone · CC BY-SA 4.0")).toBeTruthy();
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
        expect(sec.getByRole("heading").textContent).toBe("このスポットが載っている一覧");
        expect(sec.getByRole("link", { name: /京都府の寺社の撮影スポット/ }).getAttribute("href")).toBe("/spots/theme/temples-shrines/kyoto");
        unmount();
        render(<ToastProvider><SpotGuideClient spot={SPOT} photos={[]} nearby={[]} locationPath={null} /></ToastProvider>);
        expect(screen.queryByTestId("spot-topics")).toBeNull();
    });
});
