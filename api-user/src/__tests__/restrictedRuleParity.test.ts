import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRestrictedRow } from "../sanitize";

/**
 * **「絞った写真か」の判定が2つある。**
 *
 *   api/src/photos.ts            … `isRestricted`（公開の `GET /photos`）
 *   api-user/src/sanitize.ts     … `isRestrictedRow`（招待リンクの下見）
 *
 * 別のパッケージなので import で1本にできない。**複製した規則は静かに
 * ずれる**（このリポジトリが何度も踏んでいる形）ので、ここで突き合わせる。
 *
 * 綴りの比較ではなく、**api 側の本文を取り出して実際に動かして**
 * 同じ答えになることを見る——コメントに書いただけで満たされる形にしない。
 */
const ROOT = join(__dirname, "..", "..", "..");

/** `api/src/photos.ts` の `isRestricted` を取り出して、動く関数にする */
function apiSideRule(): (row: { audience?: unknown }) => boolean {
    const src = readFileSync(join(ROOT, "api", "src", "photos.ts"), "utf8");
    const m = /function isRestricted\([^)]*\)\s*:\s*boolean\s*\{([\s\S]*?)\n\}/.exec(src);
    if (!m) throw new Error("api/src/photos.ts の isRestricted が見つかりません（名前が変わった？）");
    // 型注釈を落として関数にする（本文は素の JavaScript）
    return new Function("photo", m[1]) as (row: { audience?: unknown }) => boolean;
}

describe("「絞った写真か」の規則が api と api-user で同じ", () => {
    const cases: { audience?: unknown }[] = [
        {},
        { audience: undefined },
        { audience: null },
        { audience: "" },
        { audience: "   " },
        { audience: "followers" },
        { audience: "closeFriends" },
        // **知らない綴り・将来の値も「絞った」側**（隠す側に倒す）
        { audience: "folowers" },
        { audience: "mutuals" },
        // 文字列ですらない値（手で書いた行・古い書き込み）
        { audience: 1 },
        { audience: true },
        { audience: false },
        { audience: {} },
        { audience: [] },
    ];

    it("同じ入力に同じ答えを返す", () => {
        const apiSide = apiSideRule();
        for (const row of cases) {
            expect(isRestrictedRow(row), JSON.stringify(row)).toBe(apiSide(row));
        }
    });

    // 上の比較だけだと、**両方が同時に壊れても緑**になる。
    // 「何が正しいか」も別に固定する
    it("持っていれば絞った扱い・空と欠けは公開", () => {
        expect(isRestrictedRow({})).toBe(false);
        expect(isRestrictedRow({ audience: "" })).toBe(false);
        expect(isRestrictedRow({ audience: "  " })).toBe(false);
        expect(isRestrictedRow({ audience: null })).toBe(false);
        expect(isRestrictedRow({ audience: "followers" })).toBe(true);
        expect(isRestrictedRow({ audience: "しらない値" })).toBe(true);
        expect(isRestrictedRow({ audience: false })).toBe(true);
    });
});
