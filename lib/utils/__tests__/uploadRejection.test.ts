import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unstrippableMessage, gifRejectedMessage, gifRejectedLabel } from "../uploadRejection";
import { UnstrippableFileError } from "../image";

// **同じ一文が5か所に複製されていた。**
//
// `toUploadSafeFile` が断る理由は形式だけではないのに、画面はどこも
// 「この形式は安全にアップロードできません。JPEG か PNG で保存し直して
// ください」に潰していた。デコードできない／画素が多すぎる場合は
// **形式は正しい JPEG** なので、言われたとおりにしても同じ結果になる。
describe("断る理由ごとの文言", () => {
    it.each([
        ["format", /この形式は安全に/],
        ["undecodable", /開けませんでした/],
        ["too-many-pixels", /画素数が多すぎて/],
    ] as const)("%s", (reason, expected) => {
        expect(unstrippableMessage(new UnstrippableFileError("image/jpeg", reason), "ja"))
            .toMatch(expected);
    });

    it("理由の分からない例外は形式の文言に落とす", () => {
        expect(unstrippableMessage(new Error("boom"), "ja")).toMatch(/この形式は安全に/);
    });

    it("英語も理由ごとに分かれる", () => {
        const en = (r: "undecodable" | "format") =>
            unstrippableMessage(new UnstrippableFileError("image/jpeg", r), "en");
        expect(en("undecodable")).not.toBe(en("format"));
        expect(en("undecodable")).toMatch(/couldn't be opened/);
    });
});

// **文言を複製し直したら意味が無い。** 画面は共有の関数を通すこと。
//
// **最初の版は名前どおりのことを見ていなかった**（レビューが実証）:
//   - 禁止の判定が `"この形式は…` とダブルクォート直後だけ → テンプレート
//     リテラルやシングルクォートで書き直すと全緑
//   - 3つの文言のうち1つしか見ていなかった
//   - `toContain("unstrippableMessage")` は **import 行だけで満たされる**
//     ので、使用箇所を全部消しても通る
// 引用の形に依らず「文そのもの」を探し、呼び出し（括弧つき）を見る。
describe("画面は文言を自前で持たない", () => {
    const ROOT = join(__dirname, "..", "..", "..");
    const SCREENS = [
        "app/user/upload/page.tsx",
        "app/components/stories/StoriesBar.tsx",
        "app/user/profile/page.tsx",
    ];
    // 共有の関数が返す文（日本語・英語とも）。どれか1つでも画面が自前で
    // 持っていたら、理由ごとの出し分けがそこだけ効かなくなる
    const SENTENCES = [
        ...(["format", "undecodable", "too-many-pixels"] as const).flatMap((r) => [
            unstrippableMessage(new UnstrippableFileError("image/jpeg", r), "ja"),
            unstrippableMessage(new UnstrippableFileError("image/jpeg", r), "en"),
        ]),
        gifRejectedMessage("ja"), gifRejectedMessage("en"),
        gifRejectedLabel("ja"), gifRejectedLabel("en"),
    ];

    const codeOf = (rel: string) =>
        readFileSync(join(ROOT, rel), "utf8")
            .replace(/^\s*\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "");

    it.each(SCREENS)("%s は共有の関数を呼ぶ", (rel) => {
        const src = codeOf(rel);
        expect(src, "import しただけで使っていない")
            .toMatch(/(unstrippableMessage|gifRejected(Message|Label))\s*\(/);
    });

    // **言語を決め打ちで渡さない。** `profile/page.tsx` は同じファイルで
    // `locale === "en"` を50か所以上使っているのに、ここだけ `"ja"` を
    // 直書きしていた——英語UIに日本語のトーストが出る（変異させても
    // どのテストも落ちなかった）
    it.each(SCREENS)("%s は言語を決め打ちしない", (rel) => {
        expect(codeOf(rel), "言語を直書きしている（英語UIに日本語が出る）")
            .not.toMatch(/(unstrippableMessage|gifRejected(Message|Label))\(\s*[^)]*["'`](ja|en)["'`]/);
    });

    it.each(SCREENS.flatMap((rel) => SENTENCES.map((sentence) => [rel, sentence] as const)))(
        "%s が自前で持っていない: %s",
        (rel, sentence) => {
            expect(codeOf(rel), "文言を自前で持っている（出し分けが効かない）")
                .not.toContain(sentence);
        });
});
