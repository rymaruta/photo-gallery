import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
        view(lightCalendar(SPOT.coords, undefined));
        const section = screen.getByTestId("spot-light");
        expect(screen.getByRole("heading", { name: "撮影の光" })).toBeTruthy();
        const rows = section.querySelectorAll("tbody tr");
        expect(rows).toHaveLength(12);
        expect(rows[9].textContent).toContain("10月");
        expect(rows[9].textContent).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/);
        expect(section.textContent).toContain("各月15日の計算値（日本時間）");
        expect(screen.queryByTestId("spot-light-legend")).toBeNull();
        expect(section.textContent).toContain("天気や山・建物の影は含みません");
    });

    it("北極圏は理由の言葉と凡例（「—」だけにしない）", () => {
        view(lightCalendar({ lat: 66.5436, lng: 25.8473 }, "フィンランド"));
        const rows = screen.getByTestId("spot-light").querySelectorAll("tbody tr");
        expect(rows[0].textContent).toBe("1月10:2114:32終日");
        expect(rows[5].textContent).toContain("白夜");
        expect(rows[6].textContent).toContain("翌00:10");
        expect(screen.getByTestId("spot-light-legend").textContent).toContain("終日＝太陽が一日中低く");
    });

    it("表が無い場所は節ごと出さない", () => {
        view(null);
        expect(screen.queryByTestId("spot-light")).toBeNull();
    });

    it("海外は現地の都市名で時刻帯を書く", () => {
        view(lightCalendar({ lat: 48.8584, lng: 2.2945 }, "フランス"));
        expect(screen.getByTestId("spot-light").textContent).toContain("現地時刻・Paris");
    });
});

/**
 * **光の時刻**（その日の段・`lib/utils/spotLight.ts`）。アプリの撮影スポットの画面と同じ段・同じ文。
 * 台帳の朝・夕の文はこの節へ移り、撮影ガイドの「時間帯」には日中・夜だけが残る
 */
describe("光の時刻", () => {
    const GUIDED: Spot = {
        ...SPOT,
        timeOfDayGuide: [
            { time: "dawn", text: "朝霧の川" },
            { time: "night", text: "ガス灯の夜景" },
            { time: "dusk", text: "日没後の残照" },
        ],
    } as Spot;
    const viewSpot = (spot: Spot) => render(
        <ToastProvider>
            <SpotGuideClient spot={spot} photos={[]} nearby={[]} locationPath={null} />
        </ToastProvider>,
    );

    it("朝・夕の段（ブルー → 日の出＋方角 → ゴールデン、夕は逆順）と注記", () => {
        viewSpot(GUIDED);
        const section = screen.getByTestId("spot-today-light");
        expect(screen.getByRole("heading", { name: "光の時刻" })).toBeTruthy();
        const blocks = section.querySelectorAll("[data-testid=spot-today-light-block]");
        expect(blocks).toHaveLength(2);
        const labels = (b: Element) => [...b.querySelectorAll("[data-testid=spot-today-light-row] dt")].map((d) => d.textContent);
        expect(labels(blocks[0])).toEqual(["ブルーアワー", "日の出", "ゴールデンアワー"]);
        expect(labels(blocks[1])).toEqual(["ゴールデンアワー", "日の入り", "ブルーアワー"]);
        expect(blocks[0].textContent).toMatch(/東\S* \d+°/);
        expect(screen.getByTestId("spot-today-light-date").textContent).toContain("· 今日");
        expect(section.textContent).toContain("時刻は日本時間。");
        expect(section.textContent).toContain("ゴールデンアワーは太陽の高さが 6° から −4°");
        // 台帳の文: 朝は朝の段、日没後は夕の段、夜は撮影ガイドに残る
        expect(blocks[0].textContent).toContain("朝霧の川");
        expect(blocks[1].textContent).toContain("日没後の残照");
        expect(section.textContent).not.toContain("ガス灯の夜景");
        expect(screen.getByRole("heading", { name: "撮影ガイド" }).parentElement!.textContent).toContain("ガス灯の夜景");
        expect(screen.getByRole("heading", { name: "撮影ガイド" }).parentElement!.textContent).not.toContain("朝霧の川");
    });

    it("前後の日へ送れる・今日に戻せる", () => {
        viewSpot(GUIDED);
        const date = () => screen.getByTestId("spot-today-light-date").textContent;
        expect(screen.queryByRole("button", { name: "今日に戻す" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "次の日" }));
        expect(date()).toContain("· 明日");
        fireEvent.click(screen.getByRole("button", { name: "前の日" }));
        fireEvent.click(screen.getByRole("button", { name: "前の日" }));
        expect(date()).toContain("· 昨日");
        fireEvent.click(screen.getByRole("button", { name: "今日に戻す" }));
        expect(date()).toContain("· 今日");
    });

    it("時刻帯が引けない国は節を出さず、台帳の文は全部撮影ガイドに残す", () => {
        viewSpot({ ...GUIDED, region: { country: "アメリカ" }, coords: { lat: 40.7, lng: -74.0 } } as Spot);
        expect(screen.queryByTestId("spot-today-light")).toBeNull();
        const guide = screen.getByRole("heading", { name: "撮影ガイド" }).parentElement!.textContent;
        expect(guide).toContain("朝霧の川");
        expect(guide).toContain("日没後の残照");
    });
});
