import { describe, it, expect } from "vitest";
import { isUserId } from "../userId";

// **この関数にテストが1本も無かった。** docstring は「ここを見ないと、
// 任意の文字列を相手に見立てて行を作れる」と書いている当のもので、
// `follow` / `block` の入口はここだけで形を見ている。
// 実測（レビュー）: 文字クラスを `[0-9a-f]` → `[0-9a-z]` に緩めても
// api-user の 1,162件が全緑だった。
//
// **`userIdParity` では代わりにならない。** あちらが縛るのは
// 「スクリプトが API より緩くならないこと」＝**両方を同時に緩める**
// 変更は素通りする（実測）。絶対の厳しさはここで見る。
describe("isUserId", () => {
    it("Cognito の sub（UUID）を通す", () => {
        for (const v of [
            "22222222-2222-4222-8222-222222222222",
            "0123abcd-4567-489a-8bcd-0123456789ab",
            "0123ABCD-4567-489A-8BCD-0123456789AB",   // 大文字も同じ ID
        ]) expect(isUserId(v), `本物の sub を弾いている: ${v}`).toBe(true);
    });

    // **16進の外を通さない。** ここが緩むと、任意の文字列で
    // `follow#` / `followstats#` / `notifs#` の行を作れる
    it("16進以外の文字を通さない", () => {
        for (const v of [
            "0123abcz-4567-489a-8bcd-0123456789ab",
            "0123abcd-456z-489a-8bcd-0123456789ab",
            "0123abcd-4567-489z-8bcd-0123456789ab",
            "0123abcd-4567-489a-8bcz-0123456789ab",
            "0123abcd-4567-489a-8bcd-0123456789az",
            "0123abcd-4567-489a-8bcd-0123456789a_",
        ]) expect(isUserId(v), `16進でない文字を通している: ${v}`).toBe(false);
    });

    // **5つの群すべての桁数を見る。**
    // 一度、第1群と最終群しか動かしていなかった——中間3群を
    // `{4}` → `{1,8}` に緩めても**全4,234件が緑**だった（レビューが実証）。
    // 「絶対の厳しさはここで見る」と書いた当のものが、半分しか見ていなかった
    it("どの群も、桁数が違えば通さない", () => {
        const GROUPS = [8, 4, 4, 4, 12];
        const parts = "0123abcd-4567-489a-8bcd-0123456789ab".split("-");
        expect(parts.map((p) => p.length), "土台がずれている").toEqual(GROUPS);

        for (let g = 0; g < GROUPS.length; g++) {
            for (const delta of [-3, -1, 1, 3]) {
                const len = GROUPS[g] + delta;
                if (len <= 0) continue;
                const mutated = parts.map((p, i) => (i === g ? "a".repeat(len) : p)).join("-");
                expect(isUserId(mutated), `第${g + 1}群が ${len} 桁でも通している: ${mutated}`).toBe(false);
            }
        }
    });

    // 群を空にする（`{4}` → `{0,4}` のような緩め方）
    it("群が空でも通さない", () => {
        const parts = "0123abcd-4567-489a-8bcd-0123456789ab".split("-");
        for (let g = 0; g < parts.length; g++) {
            const mutated = parts.map((p, i) => (i === g ? "" : p)).join("-");
            expect(isUserId(mutated), `第${g + 1}群が空でも通している: ${mutated}`).toBe(false);
        }
    });

    // 区切りの数（ハイフン4本）
    it("区切りの数が違えば通さない", () => {
        for (const v of [
            "0123abcd45674 89a8bcd0123456789ab".replace(" ", ""),
            "0123abcd45674 89a-8bcd-0123456789ab".replace(" ", ""),
            "0123abcd-4567-489a-8bcd-0123-456789ab",
            "0123abcd45674 89a8bcd0123456789a".replace(" ", "") + "b",
        ]) expect(isUserId(v), `区切りの数が違うのに通している: ${v}`).toBe(false);
    });

    it("区切りの形が違うものを通さない", () => {
        for (const v of [
            "0123abcd_4567_489a_8bcd_0123456789ab",
            "0123abcd45674 89a8bcd0123456789ab",
            "0123abcd-4567489a-8bcd-0123456789ab",
        ]) expect(isUserId(v), `区切りが違うのに通している: ${v}`).toBe(false);
    });

    // **前後に何か付いたものを通さない。** 通すと `follow#<id>` のような
    // キーそのものを相手 ID として書ける
    it("前後に何か付いたものを通さない", () => {
        for (const v of [
            " 22222222-2222-4222-8222-222222222222",
            "22222222-2222-4222-8222-222222222222 ",
            "\t22222222-2222-4222-8222-222222222222",
            "22222222-2222-4222-8222-222222222222\n",
            "follow#22222222-2222-4222-8222-222222222222",
            "22222222-2222-4222-8222-222222222222#x",
        ]) expect(isUserId(v), `前後に何か付いたものを通している: ${JSON.stringify(v)}`).toBe(false);
    });

    it("空・短い文字列を通さない", () => {
        for (const v of ["", " ", "-", "me", "unknown", "not-a-uuid"]) {
            expect(isUserId(v), `通している: ${JSON.stringify(v)}`).toBe(false);
        }
    });
});
