import { describe, it, expect } from "vitest";
import { clampMiniPlayerPos } from "../miniPlayerPos";

// このテストは「ミニプレイヤーがメニューバー（ヘッダー帯）を絶対に塞げない」不変条件を固定する。
// 過去、ドラッグ式ミニプレイヤーをヘッダー上に重ねられてメニューが押せなくなる回帰が起きたため、
// その核心ロジックをここで恒久的にガードする。

const SIZE = { w: 448, h: 60 };
const VIEW = { vw: 1280, vh: 800 };
const HEADER = 80;

describe("clampMiniPlayerPos", () => {
    it("右上(ヘッダー上)へ置こうとしても y をヘッダー帯の下へ押し下げる", () => {
        const r = clampMiniPlayerPos({ x: 2000, y: 0 }, SIZE, VIEW, HEADER);
        expect(r.y).toBeGreaterThanOrEqual(HEADER); // ヘッダー帯に絶対入らない
        expect(r.x).toBe(VIEW.vw - SIZE.w);         // 右端に収まる
    });

    it("上端(y<0)を要求してもヘッダー帯の下へクランプ", () => {
        const r = clampMiniPlayerPos({ x: 100, y: -500 }, SIZE, VIEW, HEADER);
        expect(r.y).toBe(HEADER);
        expect(r.x).toBe(100);
    });

    it("常に画面内に収める（x∈[0,vw-w], y∈[headerH,vh-h]）", () => {
        for (const p of [
            { x: -100, y: -100 },
            { x: 99999, y: 99999 },
            { x: 640, y: 400 },
            { x: 0, y: 0 },
        ]) {
            const r = clampMiniPlayerPos(p, SIZE, VIEW, HEADER);
            expect(r.x).toBeGreaterThanOrEqual(0);
            expect(r.x).toBeLessThanOrEqual(VIEW.vw - SIZE.w);
            expect(r.y).toBeGreaterThanOrEqual(HEADER);
            expect(r.y).toBeLessThanOrEqual(VIEW.vh - SIZE.h);
        }
    });

    it("画面内の妥当な位置はそのまま通す", () => {
        const r = clampMiniPlayerPos({ x: 300, y: 500 }, SIZE, VIEW, HEADER);
        expect(r).toEqual({ x: 300, y: 500 });
    });

    it("box が画面より大きい退化ケースでも 0/headerH に寄せ、NaN や過剰な負値を返さない", () => {
        const big = { w: 5000, h: 5000 };
        const r = clampMiniPlayerPos({ x: 10, y: 10 }, big, VIEW, HEADER);
        expect(Number.isFinite(r.x)).toBe(true);
        expect(Number.isFinite(r.y)).toBe(true);
        expect(r.x).toBe(0);
        expect(r.y).toBe(HEADER); // 入りきらなくてもヘッダー帯は死守
    });

    it("不正な入力(NaN)でも安全側(0/headerH内)に倒す", () => {
        const r = clampMiniPlayerPos({ x: NaN, y: NaN }, { w: NaN, h: NaN }, { vw: NaN, vh: NaN }, NaN);
        expect(Number.isFinite(r.x)).toBe(true);
        expect(Number.isFinite(r.y)).toBe(true);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
    });

    it("headerH=0（ヘッダー無し）なら y=0 も許容", () => {
        const r = clampMiniPlayerPos({ x: 0, y: 0 }, SIZE, VIEW, 0);
        expect(r.y).toBe(0);
    });
});
