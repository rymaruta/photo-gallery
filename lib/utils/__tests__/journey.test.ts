import { describe, it, expect } from "vitest";
import { haversineKm, distanceLabel, kmForLabel } from "../journey";

// **プロフィールの「旅した総移動距離」を出している計算**。画面に数字が
// 出るのに、テストが1本も無かった（この隣にあった `buildJourneyPoints` は
// 呼び出し側が消えていたので、テストだけが残っていた——そちらは削除）。
//
// 期待値は実装から取らない（それでは何も確かめられない）。地理的に
// 知られている距離と、球面の定義から出る値で挟む。

const TOKYO = { lat: 35.6762, lng: 139.6503 };
const OSAKA = { lat: 34.6937, lng: 135.5023 };
const SAPPORO = { lat: 43.0618, lng: 141.3545 };

describe("haversineKm", () => {
    it("同じ地点は0km", () => {
        expect(haversineKm(TOKYO, TOKYO)).toBe(0);
    });

    it("赤道上の経度1度は約111.2km（球面の定義から）", () => {
        // 2πR/360 = 111.19km（R=6371km）
        expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1);
    });

    it("子午線上の緯度1度も約111.2km", () => {
        expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1);
    });

    it("東京〜大阪は約400km", () => {
        expect(haversineKm(TOKYO, OSAKA)).toBeGreaterThan(390);
        expect(haversineKm(TOKYO, OSAKA)).toBeLessThan(410);
    });

    it("東京〜札幌は約830km", () => {
        expect(haversineKm(TOKYO, SAPPORO)).toBeGreaterThan(820);
        expect(haversineKm(TOKYO, SAPPORO)).toBeLessThan(840);
    });

    it("向きを変えても同じ（対称）", () => {
        expect(haversineKm(TOKYO, SAPPORO)).toBeCloseTo(haversineKm(SAPPORO, TOKYO), 9);
    });

    // 地球の反対側。丸め誤差で sqrt の中が 1 をわずかに超えると
    // `Math.asin` が NaN を返す——`Math.min(1, ...)` はそのための歯止め
    it("対蹠点でも NaN にならない（半周＝約20,015km）", () => {
        const d = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
        expect(Number.isNaN(d), "対蹠点で NaN になっている").toBe(false);
        expect(d).toBeCloseTo(Math.PI * 6371, 3);
    });

    it("日付変更線をまたいでも短い方を返さない（大円距離をそのまま返す）", () => {
        // 経度 179 と -179 は実距離2度ぶんだが、haversine は差の sin で
        // 見るので短い方（約222km）になる——この性質を明示しておく
        expect(haversineKm({ lat: 0, lng: 179 }, { lat: 0, lng: -179 })).toBeCloseTo(222.39, 1);
    });
});

// iOS の `NearbyPhotos.label` と同じ刻み（1km 未満・10km 未満は小数1桁・それ以上は整数）
describe("distanceLabel", () => {
    it("刻みは iOS と同じ", () => {
        expect(distanceLabel(0.4, true)).toBe("1km以内");
        expect(distanceLabel(1, true)).toBe("約1.0km");
        expect(distanceLabel(9.94, true)).toBe("約9.9km");
        expect(distanceLabel(10, true)).toBe("約10km");
        expect(distanceLabel(12.5, true)).toBe("約13km");
        expect(distanceLabel(0.4, false)).toBe("within 1 km");
        expect(distanceLabel(3.25, false)).toBe("about 3.3 km");
    });
    it("数でない・負の値は空（NaNkm を出さない）", () => {
        expect(distanceLabel(Number.NaN, true)).toBe("");
        expect(distanceLabel(Number.POSITIVE_INFINITY, true)).toBe("");
        expect(distanceLabel(-1, true)).toBe("");
    });
});

// 画面へ渡す前に丸めても、言い方は丸める前と同じ（2回丸めで 6.445km が「約6.5km」になった）
describe("kmForLabel", () => {
    it("実データで言い方が変わった値が、丸めても同じ言い方のまま", () => {
        for (const d of [6.445, 35.498, 0.996, 1.249, 2.345, 10.495]) {
            expect(distanceLabel(kmForLabel(d), true), String(d)).toBe(distanceLabel(d, true));
        }
    });
    it("0〜200km を細かく振っても、変わるのは 9.95〜10km（約10.0km → 約10km）だけ", () => {
        const changed: number[] = [];
        for (let i = 0; i <= 200_000; i++) {
            const d = i / 1000 + 0.0003;
            if (distanceLabel(kmForLabel(d), true) !== distanceLabel(d, true)) changed.push(d);
        }
        expect(changed.every((d) => d >= 9.95 && d < 10), String(changed.slice(0, 5))).toBe(true);
    });
    it("数でない・負の値はそのまま（distanceLabel が空にする）", () => {
        expect(kmForLabel(Number.NaN)).toBeNaN();
        expect(distanceLabel(kmForLabel(-1), true)).toBe("");
    });
});
