import { describe, it, expect } from "vitest";

// **サイト名の二重付け。** ルートの `title.template` が
// `%s | Journey Photo 旅フォトギャラリー` を足すのに、ページ側でも
// 足していた ——`プライバシーポリシー | Journey Photo | 旅フォトギャラリー |
// Journey Photo 旅フォトギャラリー`（53文字中44文字が定型文）。
// 写真ページで同じものを直したのに `/privacy` に残っていた。
// レビューが「この修正にはガードが無い（戻しても全緑）」と実証したので固定する。
//
// `og:title` も同じ問題を持っていた（`og:site_name` が別に出るので、
// カードにサイト名が2回出る）。`<title>` だけ直して見落としていた。
describe("ページのタイトルにサイト名を二重に付けない", () => {
    it("/privacy", async () => {
        const { metadata } = await import("../privacy/page");
        expect(String(metadata.title), "template が足すサイト名を自分でも足している")
            .toBe("プライバシーポリシー");
        expect(String(metadata.openGraph?.title), "og:site_name と合わせてサイト名が2回出る")
            .toBe("プライバシーポリシー");
    });
});
