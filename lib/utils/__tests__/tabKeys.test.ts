import { describe, it, expect } from "vitest";
import { nextTabIndex } from "../tabKeys";

/**
 * `nextTabIndex` は `NotificationsBell`（タブ4つ）と `SpotPageClient`（3つ）の
 * 二重だった判断を1つにしたもの。**元の2か所と答えが一致すること**を固定する。
 */
describe("nextTabIndex", () => {
    it("ArrowRight は次へ、最後なら先頭へ折り返す", () => {
        expect(nextTabIndex("ArrowRight", 0, 4)).toBe(1);
        expect(nextTabIndex("ArrowRight", 2, 4)).toBe(3);
        expect(nextTabIndex("ArrowRight", 3, 4)).toBe(0);
    });

    it("ArrowLeft は前へ、先頭なら最後へ折り返す", () => {
        expect(nextTabIndex("ArrowLeft", 3, 4)).toBe(2);
        expect(nextTabIndex("ArrowLeft", 1, 4)).toBe(0);
        expect(nextTabIndex("ArrowLeft", 0, 4)).toBe(3);
    });

    it("Home は先頭、End は最後", () => {
        expect(nextTabIndex("Home", 2, 4)).toBe(0);
        expect(nextTabIndex("Home", 0, 4)).toBe(0);
        expect(nextTabIndex("End", 0, 4)).toBe(3);
        expect(nextTabIndex("End", 3, 4)).toBe(3);
    });

    // **関係ないキーは `null`。** 呼ぶ側はこれを見て `preventDefault()` を
    // 飛ばす——止めると `Tab` や文字入力まで飲む
    it("タブに関係ないキーは null（呼ぶ側が preventDefault を飛ばせる）", () => {
        for (const k of ["Tab", "Enter", " ", "a", "ArrowUp", "ArrowDown", "Escape", "PageDown", ""]) {
            expect(nextTabIndex(k, 1, 4), `${k} を拾ってしまっている`).toBeNull();
        }
    });

    // **元の2か所と同じ答えになること。** 実装を写した先で式の形が違って
    // いたので（`i === last ? 0 : i + 1` と `(at + 1) % len`）、
    // 全ての位置で突き合わせる
    it("元の2か所の式と、全ての位置で答えが一致する", () => {
        for (const count of [3, 4]) {
            const last = count - 1;
            for (let i = 0; i < count; i++) {
                // NotificationsBell の式
                expect(nextTabIndex("ArrowRight", i, count)).toBe(i === last ? 0 : i + 1);
                expect(nextTabIndex("ArrowLeft", i, count)).toBe(i === 0 ? last : i - 1);
                // SpotPageClient の式
                expect(nextTabIndex("ArrowRight", i, count)).toBe((i + 1) % count);
                expect(nextTabIndex("ArrowLeft", i, count)).toBe((i - 1 + count) % count);
                expect(nextTabIndex("Home", i, count)).toBe(0);
                expect(nextTabIndex("End", i, count)).toBe(count - 1);
            }
        }
    });

    // **範囲内の答えしか返さない。** 元の `NotificationsBell` は
    // `at = -1`（状態が一覧に無い）＋ ArrowLeft で `-2` を作り、
    // `NOTIF_TABS[-2]` = `undefined` を `setTab` に渡していた
    it("範囲外の位置でも、範囲内の答えしか返さない", () => {
        for (const at of [-1, -2, 4, 99, 1.5, NaN]) {
            for (const k of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
                const to = nextTabIndex(k, at, 4);
                expect(to, `${k} / at=${at}`).not.toBeNull();
                expect(to!, `${k} / at=${at} が範囲外`).toBeGreaterThanOrEqual(0);
                expect(to!, `${k} / at=${at} が範囲外`).toBeLessThan(4);
            }
        }
    });

    // タブが無い／数がおかしいときは動かさない（`% 0` の NaN を返さない）
    it("タブが0個以下・整数でない数なら null", () => {
        for (const count of [0, -1, 1.5, NaN]) {
            expect(nextTabIndex("ArrowRight", 0, count), `count=${count}`).toBeNull();
            expect(nextTabIndex("Home", 0, count), `count=${count}`).toBeNull();
            expect(nextTabIndex("End", 0, count), `count=${count}`).toBeNull();
        }
    });

    it("タブが1個なら、どのキーでもその1個", () => {
        for (const k of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
            expect(nextTabIndex(k, 0, 1), k).toBe(0);
        }
    });
});
