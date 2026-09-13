import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * **認証の画面の入力に `autocomplete` を欠かさない。**
 *
 * パスワード管理と、iOS/Android の**確認コードの自動入力**が効くかどうかは
 * ここで決まる。実測（2026-09-12）では10欄中7欄に付いていて、欠けていたのは
 * **いちばん効く3欄**だった:
 *
 *     /login  確認コード        → one-time-code
 *     /login  新しいパスワード  → new-password（ブラウザの強力なパスワード提案）
 *     /signup 確認コード        → one-time-code
 *
 * **入力欄を1つ足したときに、付け忘れをここで捕まえる**のがこのテストの仕事。
 * 画面を描かずにソースを読むのは、`autocomplete` が**描画に出ない属性**で、
 * どの状態（`step`）の入力かに依存せず全部を見たいため。
 */
const FILES = ["app/login/page.tsx", "app/signup/page.tsx"] as const;

/** `<input` から `/>` までを1つの塊として取り出す（`=>` で切れないように） */
function inputBlocks(src: string): string[] {
    const lines = src.split("\n");
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes("<input")) continue;
        const blk: string[] = [];
        for (let j = i; j < Math.min(i + 25, lines.length); j++) {
            blk.push(lines[j]);
            if (/\/>\s*$/.test(lines[j])) break;
        }
        out.push(blk.join("\n"));
    }
    return out;
}

const typeOf = (b: string) => b.match(/type="(\w+)"/)?.[1] ?? "text";
const NEEDS = (t: string) => !["file", "checkbox", "radio", "color", "hidden", "range"].includes(t);

describe("認証の画面の入力に autocomplete がある", () => {
    for (const f of FILES) {
        it(`${f}: 打ち込む入力すべてに付いている`, () => {
            const blocks = inputBlocks(readFileSync(f, "utf-8")).filter((b) => NEEDS(typeOf(b)));
            expect(blocks.length, "入力が1つも取れていない＝取り出し方が壊れている").toBeGreaterThan(3);
            const missing = blocks.filter((b) => !/autoComplete="[^"]+"/.test(b)).map(typeOf);
            expect(missing, "autocomplete の無い入力がある").toEqual([]);
        });
    }

    // **値まで見る。** 「何か付いている」だけだと、確認コードに `email` を
    // 付けるような取り違えが素通りする
    it("確認コードは one-time-code、新しいパスワードは new-password", () => {
        const login = readFileSync("app/login/page.tsx", "utf-8");
        const signup = readFileSync("app/signup/page.tsx", "utf-8");
        const pick = (src: string, value: string) =>
            inputBlocks(src).filter((b) => b.includes(`value={${value}}`));
        expect(pick(login, "resetCode")[0]).toContain('autoComplete="one-time-code"');
        expect(pick(login, "newPassword")[0]).toContain('autoComplete="new-password"');
        expect(pick(signup, "code")[0]).toContain('autoComplete="one-time-code"');
        // 既にあった側も固定する（外す変異を落とす）
        expect(pick(login, "password")[0]).toContain('autoComplete="current-password"');
        expect(pick(signup, "confirmPassword")[0]).toContain('autoComplete="new-password"');
    });
});
