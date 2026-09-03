import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unstrippableMessage } from "../uploadRejection";
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

// **文言を複製し直したら意味が無い。** 5か所とも共有の関数を通すこと。
// （台帳の型2「複製した規則は静かにずれる」。実際、5か所のうち1か所だけ
// 「JPEG か PNG で保存し直してください。」の句点が違っていた）
describe("画面は文言を自前で持たない", () => {
    const ROOT = join(__dirname, "..", "..", "..");
    const SCREENS = [
        "app/user/upload/page.tsx",
        "app/components/stories/StoriesBar.tsx",
        "app/user/profile/page.tsx",
    ];

    it.each(SCREENS)("%s は共有の関数を使う", (rel) => {
        const src = readFileSync(join(ROOT, rel), "utf8");
        expect(src, "UnstrippableFileError を拾っているのに共有の関数を使っていない")
            .toContain("unstrippableMessage");
        // コメントの引用ではなく、実際の文字列リテラルとして持っていないこと
        const withoutComments = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
        expect(withoutComments, "文言を自前で持っている（理由ごとの出し分けが効かない）")
            .not.toMatch(/"この形式は安全にアップロードできません/);
    });
});
