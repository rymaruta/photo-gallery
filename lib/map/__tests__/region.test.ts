import { describe, it, expect } from "vitest";
import { fitView, project, spanForView, unprojectLat, zoomFromSpan } from "../region";

// Apple のマップには「ズームの段」が無い。`PhotoMap` は段で考える（URL の `#12/…`・
// 控え・現在地・束ねる升）ので、範囲の幅と行き来する換算がずれると、Leaflet の頃と
// 違う場所に着地する
describe("ズームの段と範囲の換算", () => {
    it("段 → 経度の幅 → 段 で元に戻る", () => {
        for (const zoom of [2, 4.5, 12, 18]) {
            const { longitudeDelta } = spanForView({ lat: 35.4, lng: 138.9 }, zoom, 390, 520);
            expect(zoomFromSpan(longitudeDelta, 390)).toBeCloseTo(zoom, 9);
        }
    });

    it("段0で世界1周が 256px（Leaflet と同じ定義）", () => {
        expect(zoomFromSpan(360, 256)).toBeCloseTo(0, 12);
        // 1段で2倍
        expect(zoomFromSpan(180, 256)).toBeCloseTo(1, 12);
    });

    it("幅が0（隠れている列）なら NaN を返す（その値を覚えさせない）", () => {
        expect(zoomFromSpan(10, 0)).toBeNaN();
        expect(zoomFromSpan(0, 390)).toBeNaN();
    });

    it("緯度の幅は高緯度ほど狭い（メルカトル）", () => {
        const eq = spanForView({ lat: 0, lng: 0 }, 6, 390, 520).latitudeDelta;
        const north = spanForView({ lat: 60, lng: 0 }, 6, 390, 520).latitudeDelta;
        expect(north).toBeLessThan(eq);
        // 縦の px をメルカトルで戻すので、真ん中で割った上下の px がそろう
        const { y } = project(60, 0, 6);
        expect(unprojectLat(y, 6)).toBeCloseTo(60, 9);
    });
});

describe("矩形を収める（Leaflet の fitBounds と同じ決め方）", () => {
    it("余白を除いた枠にちょうど収まる段を選ぶ", () => {
        const b = { south: 35, west: 138, north: 36, east: 140 };
        const v = fitView(b, 400, 600, 32, 18);
        const nw = project(b.north, b.west, v.zoom);
        const se = project(b.south, b.east, v.zoom);
        const w = se.x - nw.x, h = se.y - nw.y;
        // どちらかの辺がちょうど枠いっぱい、もう片方は収まっている
        expect(w).toBeLessThanOrEqual(400 - 64 + 1e-6);
        expect(h).toBeLessThanOrEqual(600 - 64 + 1e-6);
        expect(Math.max(w / (400 - 64), h / (600 - 64))).toBeCloseTo(1, 9);
        expect(v.lng).toBeCloseTo(139, 12);
    });

    it("1点だけ（幅0）なら上限まで寄る", () => {
        const v = fitView({ south: 35, west: 138, north: 35, east: 138 }, 400, 600, 32, 12);
        expect(v.zoom).toBe(12);
        expect(v.lat).toBeCloseTo(35, 9);
        expect(v.lng).toBe(138);
    });

    it("上限より寄らない", () => {
        const v = fitView({ south: 35, west: 138, north: 35.0001, east: 138.0001 }, 400, 600, 32, 12);
        expect(v.zoom).toBe(12);
    });
});
