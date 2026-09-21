import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **Photo Quest の日付の扱いは、2か所に写しがある。**
 *
 * 画面側（`lib/quest/questDate.ts`）とユーザーAPI（`api-user/src/questDate.ts`）。
 * `api-user` は別パッケージ・別の esbuild で、ルートの `lib` を import
 * できない（`publicFeed.ts` `cdnInvalidate.ts` `env.ts` と同じ事情。
 * `duplicateFilesParity.test.ts` が見張っているのは `api` と `api-user` の
 * 間だけなので、**この組み合わせはそこに入らない**）。
 *
 * ずれると**行を見ても分からない壊れ方**をする:
 *
 * - 参加の窓（`QUEST_JOIN_WINDOW_DAYS`）がずれる
 *   → 画面が「今日のクエスト」として出している日付を、サーバーが
 *     範囲外として撥ねる。押した人には理由が分からない
 * - 行 id（`questRowId`）の綴りがずれる
 *   → **書いた先と読む先が別の行になる**。参加は 200 で返るのに
 *     一覧にはいつまでも出ない（どちらも「正常」に見える）
 * - 日付の検証がずれる
 *   → 片方だけが `2026-02-31` を通し、存在しない日付の行ができる
 *
 * `publicFeedParity` と同じ手で、**コメントを落としたコードを突き合わせる**。
 * いまは `cp` した完全一致なので生のバイトでも通るが、片側にだけ
 * パッケージ都合のコメントが付く日に備えてコード比較にしてある。
 */

const ROOT = join(__dirname, "..", "..");

const SOURCES = [
    { rel: "lib/quest/questDate.ts", label: "画面側" },
    { rel: "api-user/src/questDate.ts", label: "ユーザーAPI側" },
];

/** コメントと空白を落としたコード */
const codeOf = (rel: string) =>
    readFileSync(join(ROOT, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ")
        .replace(/\s+/g, " ")
        .trim();

describe("Photo Quest の日付: 2か所の写しが一致する", () => {
    it("コメントを落としても中身が残っている（比較が空回りしていない）", () => {
        for (const s of SOURCES) {
            expect(codeOf(s.rel).length, `${s.rel} が空になった`).toBeGreaterThan(400);
        }
    });

    it("2本のコードが一致する（片方だけ直さない）", () => {
        const [a, b] = SOURCES.map((s) => codeOf(s.rel));
        expect(b, `${SOURCES[1].rel} が ${SOURCES[0].rel} と違う（片方だけ直した？）`).toBe(a);
    });

    it.each(["QUEST_JOIN_WINDOW_DAYS = 1", "quest#${dateKey}", "toISOString().slice(0, 10)"])(
        "両方が %s を持っている（要になる値が消えていない）",
        (needle) => {
            for (const s of SOURCES) {
                const raw = readFileSync(join(ROOT, s.rel), "utf8");
                expect(raw.includes(needle), `${s.rel} に ${needle} が無い`).toBe(true);
            }
        },
    );

    it("api-user 側がルートの lib を import していない（別パッケージなので解決できない）", () => {
        const raw = readFileSync(join(ROOT, "api-user/src/questDate.ts"), "utf8");
        expect(/from\s+["'][^"']*\/lib\//.test(raw), "api-user から lib を import している").toBe(false);
    });
});
