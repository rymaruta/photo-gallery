import { describe, it, expect } from "vitest";
import { nextTabIndex } from "../tabKeys";

/**
 * **2か所が同じ計算を各自で書いていた**（`SpotPageClient` と
 * `NotificationsBell`）。寄せたので、端の折り返しと「タブの操作ではない
 * キー」をここで一度だけ固定する。
 *
 * 画面側のテストは「矢印で隣へ移り、フォーカスも移る」を見ていて、
 * **`count` が 0 や範囲外のときは踏んでいない**（どちらの画面もタブの数が
 * 固定なので、画面からは作れない）。純関数にしたぶん、ここで見られる。
 */
describe("タブの矢印キー", () => {
    it("矢印で隣へ移る", () => {
        expect(nextTabIndex("ArrowRight", 0, 4)).toBe(1);
        expect(nextTabIndex("ArrowLeft", 2, 4)).toBe(1);
    });

    // WAI-ARIA の tabs は端で折り返す（行き止まりを作らない）
    it("端では折り返す", () => {
        expect(nextTabIndex("ArrowRight", 3, 4), "末尾の次が先頭になっていない").toBe(0);
        expect(nextTabIndex("ArrowLeft", 0, 4), "先頭の前が末尾になっていない").toBe(3);
    });

    it("Home / End は端へ飛ぶ", () => {
        expect(nextTabIndex("Home", 2, 4)).toBe(0);
        expect(nextTabIndex("End", 2, 4)).toBe(3);
    });

    // **`null` を返す＝呼び出し側は `preventDefault` しない。**
    // ここで 0 などを返すと、Tab や文字キーまでタブを動かし、
    // しかも既定の動作を止めてしまう
    it.each(["Tab", "Enter", " ", "a", "ArrowUp", "ArrowDown", "Escape"])(
        "タブの操作でないキー（%s）には手を出さない", (key) => {
            expect(nextTabIndex(key, 1, 4), "関係ないキーでタブが動く").toBeNull();
        });

    // 🔴 画面からは作れないが、関数としては呼べてしまう形。
    // `% 0` は NaN、`count - 1` は -1 で、どちらも**存在しない添字**
    it("タブが0個なら何も返さない", () => {
        for (const k of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
            expect(nextTabIndex(k, 0, 0), `${k} が存在しない添字を返す`).toBeNull();
        }
    });

    // 🔴 **整数でない数も「存在しない添字」を作る。**
    // `count <= 0` / `current >= 0 && current < count` だけでは `1.5` が
    // 素通りし、`ArrowRight` が **`2.5`** を返していた。呼び出し側は
    // 返り値をそのまま添字に使うので（`NOTIF_TABS[2.5]`）`undefined` が
    // `setTab` に届く。**上の「範囲の中」のテストは `at` を整数でしか
    // 回していなかったので、この穴を見ていなかった**
    it("整数でない数は、存在しない添字を作らせない", () => {
        for (const k of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
            // 数が整数でない → 何もしない
            expect(nextTabIndex(k, 0, 1.5), `count=1.5 で ${k} が答えを返す`).toBeNull();
            expect(nextTabIndex(k, 0, NaN), `count=NaN で ${k} が答えを返す`).toBeNull();
            // 選択中が整数でない → 先頭から数え直す（返すのは必ず整数）
            for (const at of [1.5, NaN]) {
                const to = nextTabIndex(k, at, 4);
                expect(to, `${k} / at=${at}`).not.toBeNull();
                expect(Number.isInteger(to!), `${k} / at=${at} が整数でない添字を返す`).toBe(true);
                expect(to!).toBeGreaterThanOrEqual(0);
                expect(to!).toBeLessThan(4);
            }
        }
    });

    // 選択中のタブが一覧から消えた直後など。負の添字を `%` に通すと負が残る
    it("選択中が範囲の外なら、先頭から数え直す", () => {
        expect(nextTabIndex("ArrowRight", -1, 4), "負の添字がそのまま計算に入っている").toBe(1);
        expect(nextTabIndex("ArrowLeft", -1, 4)).toBe(3);
        expect(nextTabIndex("ArrowRight", 99, 4)).toBe(1);
    });

    // 返すのは必ず範囲の中（呼び出し側は添字でそのまま引く）
    it("返す値は必ず範囲の中", () => {
        for (const count of [1, 2, 5]) {
            for (let at = 0; at < count; at++) {
                for (const k of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
                    const to = nextTabIndex(k, at, count);
                    expect(to, `${k} / ${at} / ${count}`).not.toBeNull();
                    expect(to!).toBeGreaterThanOrEqual(0);
                    expect(to!).toBeLessThan(count);
                }
            }
        }
    });
});
