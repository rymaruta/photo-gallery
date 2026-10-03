import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";

/**
 * **光の時刻の節は水和でずれない。**
 *
 * ページは静的に建てる＝サーバーの HTML はビルドの日に描かれ、ブラウザは別の日に水和する。
 * 「今日」を最初の描画で読むと（`useState(new Date())` など）、日付の札と時刻がサーバーと食い違い、
 * React が水和をやり直す。ここではサーバーの描画とブラウザの水和のあいだで時計を半年進めて、
 * ずれの知らせ（`onRecoverableError`・`console.error`）が1つも出ないことを見る
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
    timeOfDayGuide: [{ time: "dawn", text: "朝霧の川" }, { time: "dusk", text: "日没後の残照" }],
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-09-23",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
} as Spot;

const tree = () => (
    <ToastProvider>
        <SpotGuideClient spot={SPOT} photos={[]} nearby={[]} locationPath={null} />
    </ToastProvider>
);

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

describe("光の時刻の水和", () => {
    it("ビルドの日とブラウザの日が違っても、水和のずれが出ない・読み込み後に時刻が出る", async () => {
        window.history.replaceState(null, "", "/spots/ginzan-onsen");
        vi.useFakeTimers({ toFake: ["Date"] });
        // ビルドの日（夏至）
        vi.setSystemTime(new Date("2026-06-21T03:00:00Z"));
        const html = renderToString(tree());
        const container = document.createElement("div");
        container.innerHTML = html;
        document.body.appendChild(container);
        // 仮の行で高さを取ってあり、時刻の数字は HTML に入らない
        const ssrSection = container.querySelector("[data-testid=spot-today-light]")!;
        expect(ssrSection).toBeTruthy();
        expect(ssrSection.querySelector("[data-testid=spot-today-light-date-placeholder]")).toBeTruthy();
        expect(ssrSection.textContent).not.toMatch(/\d{2}:\d{2}/);
        expect(ssrSection.textContent).toContain("朝霧の川");

        // ブラウザで開いた日（冬至）
        vi.setSystemTime(new Date("2026-12-22T03:00:00Z"));
        const recoverable: unknown[] = [];
        const errors: string[] = [];
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
        await act(async () => {
            hydrateRoot(container, tree(), { onRecoverableError: (e) => { recoverable.push(e); } });
        });

        expect(recoverable).toEqual([]);
        expect(errors.filter((e) => /hydrat|did not match|server rendered/i.test(e))).toEqual([]);
        // 読み込み後は、その日（冬至）の札と時刻
        const date = container.querySelector("[data-testid=spot-today-light-date]");
        expect(date?.textContent).toBe("12月22日（火） · 今日");
        expect(container.querySelectorAll("[data-testid=spot-today-light-row]").length).toBe(6);
        expect(container.querySelector("[data-testid=spot-today-light-date-placeholder]")).toBeNull();
    });
});
