import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TravelRecord from "../TravelRecord";

// **旅の記録の線は、画面に出たとき一度だけ引く。** `prefers-reduced-motion` の人には動かさない。
// 静的な HTML（JS が動く前）では引き終えた形で出る——動かす仕組みが無い環境でも線は見える。

const COORDS = [
    { lat: 35.68, lng: 139.77 },  // 東京
    { lat: 25.03, lng: 121.56 },  // 台北
    { lat: 48.86, lng: 2.35 },    // パリ
];

type Fire = (entries: Array<{ isIntersecting: boolean }>) => void;
/** 線（svg）を見張っている IntersectionObserver の呼び先（`next/link` の見張りは混ぜない） */
let observed: Fire[] = [];
let reduce = false;
const animate = vi.fn(() => ({ cancel: () => {} }));

beforeEach(() => {
    observed = [];
    reduce = false;
    animate.mockClear();
    vi.stubGlobal("IntersectionObserver", class {
        cb: Fire;
        constructor(cb: Fire) { this.cb = cb; }
        observe(target: Element) { if (target.tagName.toLowerCase() === "svg") observed.push(this.cb); }
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    });
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q }));
    (Element.prototype as unknown as { animate: unknown }).animate = animate;
});
afterEach(() => {
    vi.unstubAllGlobals();
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
});

// 2026-10-31 束 1 U5: 線は畳んで始めるので、開いてから見る
const renderIt = () => {
    const r = render(
        <TravelRecord distanceKm={12345.6} countries={["日本", "台湾", "フランス", "ペルー"]} coordinates={COORDS}
                      firstYear={2023} href="/map" locale="ja" />,
    );
    fireEvent.click(screen.getByTestId("travel-route-toggle"));
    return r;
};

describe("旅の記録の線", () => {
    it("最初から引き終えた形（区間の数だけの線・最新の点）", () => {
        renderIt();
        const svg = screen.getByTestId("travel-route");
        const segs = svg.querySelectorAll("[data-seg]");
        expect(segs).toHaveLength(2);
        for (const s of segs) expect(s.getAttribute("stroke-dashoffset")).toBe("0");
        // 古い区間ほど薄い
        expect(Number(segs[0].getAttribute("opacity"))).toBeLessThan(Number(segs[1].getAttribute("opacity")));
        expect(svg.querySelector("[data-latest]")).toBeTruthy();
        expect(animate).not.toHaveBeenCalled();
    });

    it("画面に出たとき一度だけ引く", () => {
        renderIt();
        expect(observed.length).toBeGreaterThan(0);
        observed[observed.length - 1]([{ isIntersecting: true }]);
        const once = animate.mock.calls.length;
        expect(once, "引いていない").toBeGreaterThan(0);
        observed[observed.length - 1]([{ isIntersecting: true }]);
        expect(animate.mock.calls.length, "2回引いている").toBe(once);
    });

    it("🔴 視差効果を減らす設定の人には動かさない", () => {
        reduce = true;
        renderIt();
        for (const cb of observed) cb([{ isIntersecting: true }]);
        expect(animate).not.toHaveBeenCalled();
    });

    it("距離は 3 桁区切り・国は3つまで「ほか N」・年は「年から」", () => {
        renderIt();
        expect(screen.getByTestId("travel-distance").textContent).toBe("12,346km写真をつないだ距離");
        expect(screen.getByTestId("travel-countries").textContent).toBe("4か国・地域日本・台湾・フランス ほか1");
        expect(screen.getByTestId("travel-record").textContent).toContain("2023 年から");
    });
});
