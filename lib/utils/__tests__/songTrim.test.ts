import { describe, it, expect } from "vitest";
import { startFromPointer, clampStart } from "../songTrim";

// バー: 左端 x=100, 幅 300px, 全体 30秒, 範囲 5秒 を基本形とする
const LEFT = 100;
const WIDTH = 300;
const TOTAL = 30;
const WIN = 5;
const at = (x: number, win = WIN) => startFromPointer(x, LEFT, WIDTH, win, TOTAL);

describe("clampStart", () => {
    it("0未満は0に寄せる", () => {
        expect(clampStart(-4, WIN, TOTAL)).toBe(0);
    });
    it("末尾を超えないよう (全体-範囲) で止める", () => {
        expect(clampStart(99, WIN, TOTAL)).toBe(25);
    });
    it("整数秒に丸める", () => {
        expect(clampStart(7.6, WIN, TOTAL)).toBe(8);
    });
    it("範囲が全体と同じなら常に0", () => {
        expect(clampStart(10, TOTAL, TOTAL)).toBe(0);
    });
});

describe("startFromPointer", () => {
    it("押した位置が範囲の中央になる", () => {
        // 中央(x=250)は15秒 → 5秒幅なので開始は12.5→13
        expect(at(LEFT + WIDTH / 2)).toBe(13);
    });

    it("左端を押したら0から始まる", () => {
        expect(at(LEFT)).toBe(0);
    });

    it("右端を押したら末尾で止まる（範囲がはみ出さない）", () => {
        expect(at(LEFT + WIDTH)).toBe(TOTAL - WIN);
    });

    it("バーの外を押しても端で止まる", () => {
        expect(at(LEFT - 500)).toBe(0);
        expect(at(LEFT + WIDTH + 500)).toBe(TOTAL - WIN);
    });

    it("右へ動かすほど開始位置が進む（単調）", () => {
        const xs = [0, 60, 120, 180, 240, 300].map((d) => at(LEFT + d));
        for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    });

    it("範囲を長くすると、同じ位置でも開始が前にずれる", () => {
        expect(at(LEFT + WIDTH / 2, 15)).toBeLessThan(at(LEFT + WIDTH / 2, 5));
    });

    it("幅0（未描画）でも壊れず0を返す", () => {
        expect(startFromPointer(150, LEFT, 0, WIN, TOTAL)).toBe(0);
    });
});
