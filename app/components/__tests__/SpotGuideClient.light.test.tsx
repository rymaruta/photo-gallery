import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";
import { lightCalendar } from "@/lib/utils/lightCalendar";

/**
 * **撮影の光の月別の表**（サーバーが計算した文字だけを受け取る）。
 * 表の見出し・12か月・注記（天気や影は含まない）を出し、渡されなければ節ごと出さない
 */
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn(async () => ({ ok: true, json: async () => ({ slugs: [] }) })) }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotGuideClient from "../SpotGuideClient";

const SPOT: Spot = {
    spotId: "sp_92dc681b0f47",
    slug: "ginzan-onsen",
    name: "銀山温泉",
    summary: "あ".repeat(40),
    region: { country: "日本", prefecture: "山形県", city: "尾花沢市" },
    coords: { lat: 38.58, lng: 140.53 },
    highlights: ["木造多層の旅館"],
    officialWebsiteUrl: "https://example.example/",
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-09-23",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
};

const view = (light: ReturnType<typeof lightCalendar>) => render(
    <ToastProvider>
        <SpotGuideClient spot={SPOT} photos={[]} nearby={[]} locationPath={null} light={light} />
    </ToastProvider>,
);

beforeEach(() => {
    window.history.replaceState(null, "", "/spots/ginzan-onsen");
});

describe("撮影の光", () => {
    it("12か月の行・日本時間・天気や影は含まないと書く", () => {
        view(lightCalendar(SPOT.coords, undefined, 2026));
        const section = screen.getByTestId("spot-light");
        expect(screen.getByRole("heading", { name: "撮影の光" })).toBeTruthy();
        const rows = section.querySelectorAll("tbody tr");
        expect(rows).toHaveLength(12);
        expect(rows[9].textContent).toContain("10月");
        expect(rows[9].textContent).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/);
        expect(section.textContent).toContain("2026年の各月15日の計算値（日本時間）");
        expect(section.textContent).toContain("天気や山・建物の影は含みません");
    });

    it("太陽が通らない月は「—」", () => {
        view(lightCalendar({ lat: 78.2, lng: 15.6 }, "日本", 2026));
        const first = screen.getByTestId("spot-light").querySelector("tbody tr")!;
        expect(first.textContent).toBe("1月———");
    });

    it("表が無い場所は節ごと出さない", () => {
        view(null);
        expect(screen.queryByTestId("spot-light")).toBeNull();
    });

    it("海外は現地の都市名で時刻帯を書く", () => {
        view(lightCalendar({ lat: 48.8584, lng: 2.2945 }, "フランス", 2026));
        expect(screen.getByTestId("spot-light").textContent).toContain("現地時刻・Paris");
    });
});
