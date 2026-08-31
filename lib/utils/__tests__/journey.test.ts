import { describe, it, expect } from "vitest";
import { haversineKm } from "../journey";

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
