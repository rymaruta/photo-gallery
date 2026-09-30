import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { TripPlan } from "../../../lib/hooks/useTripPlans";

/**
 * 旅行プランの当日モード（`TripLightCard`）。前日から最終日まで、今日か明日の撮影スポットの
 * 光の時刻と季節の案内。**当たらない・読めない間は何も出さない**
 */
import TripLightCard from "../TripLightCard";

const SPOTS = {
    sp_g: { slug: "ginzan-onsen", name: "銀山温泉" },
    sp_s: { slug: "santa-claus-village", name: "サンタクロース村" },
};
const BODIES: Record<string, unknown> = {
    "ginzan-onsen": { slug: "ginzan-onsen", spotId: "sp_g", name: "銀山温泉", coords: { lat: 38.58, lng: 140.53 },
        seasonalGuide: [{ season: "autumn", text: "滝のまわりが紅葉する。" }] },
    "santa-claus-village": { slug: "santa-claus-village", spotId: "sp_s", name: "サンタクロース村",
        coords: { lat: 66.5436, lng: 25.8473 }, country: "フィンランド", seasonalGuide: [] },
};
const plan = (start: string, end: string, days: string[][]): TripPlan => ({
    planId: "p", title: "旅", startDate: start, endDate: end,
    days: days.map((ids) => ({ items: ids.map((spotId) => ({ kind: "spot" as const, spotId })) })),
});

const fetchMock = vi.fn();

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
        const slug = decodeURIComponent(url.split("/").pop()!.replace(/\.json$/, ""));
        const body = BODIES[slug];
        return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => null };
    });
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("旅行プランの当日モード", () => {
    it("前日: 明日（1日目）の撮影スポットの光の時刻と季節の案内", async () => {
        // 端末の時刻帯（テストは UTC）で 2026-10-09
        vi.setSystemTime(new Date("2026-10-09T03:00:00Z"));
        render(<TripLightCard plans={[plan("2026-10-10", "2026-10-11", [["sp_g"], []])]} spots={SPOTS} en={false} />);
        const card = await screen.findByTestId("trip-light");
        expect(card.textContent).toContain("明日 · 1日目 · 10/10");
        expect(screen.getByRole("link", { name: "銀山温泉" }).getAttribute("href")).toBe("/spots/ginzan-onsen");
        // Web の sunTimes.test.ts と同じ値（銀山温泉 2026-10-10）
        expect(card.textContent).toContain("16:34–17:26");
        expect(card.textContent).toContain("17:09");
        expect(card.textContent).toContain("秋: 滝のまわりが紅葉する。");
        expect(card.textContent).toContain("天気や山・建物の影は含みません");
        expect(fetchMock).toHaveBeenCalledWith("/app/data/spots/ginzan-onsen.json");
    });

    it("海外は旅先の時計・北極圏は表と同じ言い分け（7月の日の入りは「翌」）", async () => {
        vi.setSystemTime(new Date("2026-07-15T03:00:00Z"));
        render(<TripLightCard plans={[plan("2026-07-15", "2026-07-15", [["sp_s"]])]} spots={SPOTS} en={false} />);
        const card = await screen.findByTestId("trip-light");
        expect(card.textContent).toContain("今日 · 1日目 · 7/15");
        expect(card.textContent).toContain("翌00:10");
        expect(card.textContent).toContain("21:59–（明け方まで）");
    });

    it("2日前・帰ったあと・本文が読めない日は何も出さない", async () => {
        vi.setSystemTime(new Date("2026-10-08T03:00:00Z"));
        const { container, unmount } = render(<TripLightCard plans={[plan("2026-10-10", "2026-10-11", [["sp_g"], []])]} spots={SPOTS} en={false} />);
        await new Promise((r) => setTimeout(r, 20));
        expect(container.textContent).toBe("");
        expect(fetchMock).not.toHaveBeenCalled();
        unmount();

        vi.setSystemTime(new Date("2026-10-10T03:00:00Z"));
        fetchMock.mockImplementation(async () => ({ ok: false, status: 404, json: async () => null }));
        const r2 = render(<TripLightCard plans={[plan("2026-10-10", "2026-10-11", [["sp_g"], []])]} spots={SPOTS} en={false} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 20));
        expect(r2.container.textContent).toBe("");
    });

    it("1件目が読めなければ次の撮影スポットへ", async () => {
        vi.setSystemTime(new Date("2026-10-10T03:00:00Z"));
        const spots = { ...SPOTS, sp_x: { slug: "missing", name: "無い" } };
        render(<TripLightCard plans={[plan("2026-10-10", "2026-10-10", [["sp_x", "sp_g"]])]} spots={spots} en={false} />);
        expect((await screen.findByTestId("trip-light")).textContent).toContain("銀山温泉");
    });
});
