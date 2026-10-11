import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";
import type { SpotSample } from "@/lib/data/spotSamples";
import { lightCalendar } from "@/lib/utils/lightCalendar";
import { spotSky } from "@/lib/utils/spotSky";

/**
 * 座標から計算した撮影の事実（2026-10-11）: 方角の振れ幅・天の川・新月・作例の撮影月。
 * どれもサーバーが渡した値をそのまま描く（静的な HTML に焼ける）。
 * 撮影ガイドの頭の要約は、季節・時間帯の案内が無い行だけ
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
    coords: { lat: 35.6895, lng: 139.6917 },
    highlights: ["木造多層の旅館"],
    officialWebsiteUrl: "https://example.example/",
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-09-23",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
};
const NOW = new Date("2026-10-11T03:00:00Z");
const SKY = spotSky(SPOT.coords, "日本", null, NOW)!;

const sample = (n: number, takenAt?: string): SpotSample => ({
    src: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/S${n}.jpg/1280px-S${n}.jpg`,
    width: 1280, height: 960, title: `S${n}`, author: "Someone", license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0", sourceUrl: `https://commons.wikimedia.org/wiki/File:S${n}.jpg`,
    ...(takenAt ? { takenAt } : {}),
});

const view = (spot: Spot, opts: { sky?: typeof SKY | null; samples?: SpotSample[] } = {}) => render(
    <ToastProvider>
        <SpotGuideClient spot={spot} photos={[]} nearby={[]} locationPath={null}
                         light={lightCalendar(spot.coords, "日本")} sky={opts.sky === undefined ? SKY : opts.sky}
                         samples={opts.samples ?? []} />
    </ToastProvider>,
);

beforeEach(() => {
    window.history.replaceState(null, "", "/spots/ginzan-onsen");
});

describe("座標から計算した撮影の事実", () => {
    it("撮影の光: 方角の振れ幅の文と、時刻の下の方角", () => {
        view(SPOT);
        expect(screen.getByTestId("spot-light-swing").textContent).toContain("6月21日ごろは日の出が東北東 60°・日の入りが西北西 300°");
        const june = screen.getByTestId("spot-light").querySelectorAll("tbody tr")[5];
        expect(june.textContent).toContain("東北東");
        expect(june.textContent).toContain("西北西 300°");
    });

    it("星空の暦: 天の川の月と時刻帯の表・今後12か月の新月・何日時点か", () => {
        view(SPOT);
        const sec = screen.getByTestId("spot-night-sky");
        expect(screen.getByRole("heading", { name: "星空の暦" })).toBeTruthy();
        expect(screen.getByTestId("spot-milky-way-summary").textContent).toContain("天の川の中心は2〜10月の夜");
        const rows = screen.getByTestId("spot-milky-way").querySelectorAll("tbody tr");
        expect(rows.length).toBe(SKY.milkyWay.months.length);
        expect([...rows].map((r) => r.querySelector("th")!.textContent)).toContain("6月");
        const moons = screen.getByTestId("spot-new-moons");
        expect(moons.textContent).toContain("今後12か月の新月（2026年10月11日時点）");
        expect(moons.querySelectorAll("li")).toHaveLength(13);
        expect(moons.querySelector("time")!.getAttribute("dateTime")).toBe("2026-10-11");
        expect(sec.querySelector("thead")!.textContent).toContain("天の川の中心が見える高さにある時刻");
        expect(sec.textContent).toContain("月明かり・天気・光害・山の影は含みません");
    });

    it("見える月が無い緯度は表を出さず、上がる高さを言う", () => {
        const north = { ...SPOT, coords: { lat: 60.17, lng: 24.94 } };
        view(north, { sky: spotSky(north.coords, "日本", null, NOW) });
        expect(screen.queryByTestId("spot-milky-way")).toBeNull();
        expect(screen.getByTestId("spot-milky-way-summary").textContent).toContain("最大 1° までしか上がらず");
    });

    it("撮影ガイドの頭: 季節・時間帯の案内が無い行は計算の要約が主役（節ごと出る）", () => {
        view(SPOT);
        const lead = screen.getByTestId("spot-guide-lead");
        expect(lead.textContent).toBe("日の入りは6月が西北西寄り、12月が西南西寄り。天の川の中心は2〜10月の夜。");
        expect(screen.getByRole("heading", { name: "撮影ガイド" })).toBeTruthy();
    });

    it("季節の案内がある行は、そちらを優先して要約を出さない", () => {
        view({ ...SPOT, seasonalGuide: [{ season: "winter", text: "雪の夜のガス灯" }] } as Spot);
        expect(screen.queryByTestId("spot-guide-lead")).toBeNull();
        expect(screen.getByText("雪の夜のガス灯")).toBeTruthy();
    });

    it("時間帯の案内だけがある行も、そちらを優先して要約を出さない", () => {
        view({ ...SPOT, timeOfDayGuide: [{ time: "night", text: "ガス灯の夜景" }] } as Spot);
        expect(screen.queryByTestId("spot-guide-lead")).toBeNull();
        expect(screen.getByText("ガス灯の夜景")).toBeTruthy();
    });

    it("天の川の見える月が無い緯度は、ガイドの頭に天の川の文を入れない（星空の暦には残す）", () => {
        const north = { ...SPOT, coords: { lat: 60.17, lng: 24.94 } };
        view(north, { sky: spotSky(north.coords, "日本", null, NOW) });
        expect(screen.getByTestId("spot-guide-lead").textContent).toBe("日の入りは6月が北西寄り、12月が南西寄り。");
        expect(screen.getByTestId("spot-milky-way-summary").textContent).toContain("最大 1° までしか上がらず");
    });

    it("計算の値が無い（sky=null）なら節も要約も出さない", () => {
        view(SPOT, { sky: null });
        expect(screen.queryByTestId("spot-night-sky")).toBeNull();
        expect(screen.queryByTestId("spot-guide-lead")).toBeNull();
        expect(screen.queryByTestId("spot-light-swing")).toBeNull();
    });

    it("作例が撮られた月（撮影日の分かる分だけ）", () => {
        view(SPOT, { samples: [sample(1, "2016-10-14 13:41:43"), sample(2, "Taken on 2 October 2010"), sample(3, "2011年4月1日"), sample(4, "2003"), sample(5)] });
        expect(screen.getByTestId("spot-sample-months").textContent).toBe("作例が撮られた月（撮影日の分かる3枚）: 4月 1枚・10月 2枚");
    });

    it("撮影日の分かる作例が無ければ行を出さない", () => {
        view(SPOT, { samples: [sample(1, "Unknown date"), sample(2)] });
        expect(screen.getByTestId("spot-samples")).toBeTruthy();
        expect(screen.queryByTestId("spot-sample-months")).toBeNull();
    });
});
