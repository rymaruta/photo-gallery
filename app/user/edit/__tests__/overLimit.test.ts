import { describe, it, expect } from "vitest";
import { describeOverLimit, mergeLocalizedDescription } from "../page";

// **一度、存在しない上限の警告を出した。**
//
// サーバー（`api-user/src/sanitize.ts` の `sanitizeDescription`）は、
// 説明を**送る形で違う扱い**にする:
//
//   文字列          → 全体を 2000字で切る（**段落数は一切見ない**）
//   {ja:[],en:[]}   → 段落ごと2000字 かつ 50段落まで
//
// ところが「文字列にも50段落が効く」と思い込んで、両画面に
// 「説明は50段落までです」と出していた。`mergeLocalizedDescription` は
// 元の写真に英語説明が無ければ**文字列を返す**ので、日本語だけの写真
// （このサイトの大半）では**必ず誤報**。しかも本物の上限（全体2000字）は
// 野放しのままだった——直したかった形をそのまま残して、嘘だけ足していた。

const P = (n: number) => Array.from({ length: n }, (_, i) => `段落${i}`);

describe("文字列で送るとき（段落数は見ない）", () => {
    // **これが回帰の本体。** 51段落あっても、文字列なら切られない
    it("51段落でも、2000字以内なら何も言わない", () => {
        const text = P(51).join("\n");
        expect(text.length).toBeLessThan(2000);
        expect(describeOverLimit(undefined, text, true),
            "文字列に段落の上限は効かないのに警告している").toBeNull();
    });

    it("2000字を超えたら、文字数で言う", () => {
        const msg = describeOverLimit(undefined, "あ".repeat(2001), true);
        expect(msg).toMatch(/2000字/);
        expect(msg, "文字列なのに段落で言っている").not.toMatch(/段落/);
    });

    it("ちょうど2000字なら言わない", () => {
        expect(describeOverLimit(undefined, "あ".repeat(2000), true)).toBeNull();
    });

    // 前後の空白はサーバーが `trim()` してから数える
    it("前後の空白は数えない", () => {
        expect(describeOverLimit(undefined, `  ${"あ".repeat(2000)}  `, true)).toBeNull();
    });
});

describe("{ja,en} で送るとき（段落数を見る）", () => {
    it("51段落なら段落で言う", () => {
        const msg = describeOverLimit(undefined, { ja: P(51), en: ["x"] }, true);
        expect(msg).toMatch(/50段落/);
    });

    it("ちょうど50段落なら言わない", () => {
        expect(describeOverLimit(undefined, { ja: P(50), en: ["x"] }, true)).toBeNull();
    });

    // **段落ごとにも2000字で切られる**（`sanitize.ts` の
    // `.map((p) => truncate(p.trim(), 2000))`）。件数だけ見ていたので、
    // 英語説明を持つ写真で長い段落を1つ書くと**警告なしで黙って切られた**
    // ——同じ文章でも、英語を持たない写真なら「2000字までです」と出る。
    // **写真によって言ったり言わなかったり**していた。
    it("1段落が2000字を超えたら言う", () => {
        const msg = describeOverLimit(undefined, { ja: ["短い", "あ".repeat(2001)], en: ["x"] }, true);
        expect(msg, "段落の長さを見ていない").toMatch(/1段落2000字/);
    });

    it("ちょうど2000字の段落なら言わない", () => {
        expect(describeOverLimit(undefined, { ja: ["あ".repeat(2000)], en: ["x"] }, true)).toBeNull();
    });

    it("英語のときは英語で言う（段落の長さ）", () => {
        expect(describeOverLimit(undefined, { ja: ["a".repeat(2001)], en: ["x"] }, false))
            .toMatch(/Up to 2000 characters per paragraph/);
    });
});

// **送る形は `mergeLocalizedDescription` が決める。** 判定がそれと
// 食い違うと、また誤報になる
describe("送る形と判定が食い違わない", () => {
    it("英語を持たない写真は文字列 → 51段落でも黙る", () => {
        const next = mergeLocalizedDescription(undefined, P(51).join("\n"));
        expect(typeof next, "文字列で送る前提が崩れている").toBe("string");
        expect(describeOverLimit(undefined, next, true)).toBeNull();
    });

    it("英語を持つ写真は配列 → 51段落で言う", () => {
        const next = mergeLocalizedDescription({ ja: ["旧"], en: ["Old"] }, P(51).join("\n"));
        expect(typeof next, "配列で送る前提が崩れている").not.toBe("string");
        expect(describeOverLimit(undefined, next, true)).toMatch(/50段落/);
    });
});

describe("タグと、送らない項目", () => {
    it("31個で言う / 30個は言わない", () => {
        const tag = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
        expect(describeOverLimit(tag(31), undefined, true)).toMatch(/30個/);
        expect(describeOverLimit(tag(30), undefined, true)).toBeNull();
    });

    // **送らない項目について言わない。** 変えていない説明について
    // 「超えた分は保存されません」と出すのは嘘（タイトルだけ直した保存で
    // 毎回出ていた）
    it("undefined（＝送らない）なら何も言わない", () => {
        expect(describeOverLimit(undefined, undefined, true)).toBeNull();
    });

    it("英語のときは英語で言う", () => {
        expect(describeOverLimit(undefined, "a".repeat(2001), false)).toMatch(/Up to 2000 characters/);
    });
});
