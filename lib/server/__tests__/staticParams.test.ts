import { describe, it, expect } from "vitest";
import { withPlaceholderParam, EMPTY_PARAM_PLACEHOLDER } from "../staticParams";

// Next.js の output: export は generateStaticParams が空配列を返すと
// 「関数が定義されていない」扱いでビルドを落とす。
//   Error: Page "/category/[category]" is missing "generateStaticParams()"
// つまり写真が1枚も無いとサイトをビルドできない。
// 作りたての staging で実際に踏んだが、本番でも全写真を非公開にすれば同じ。
describe("withPlaceholderParam", () => {
    it("空なら1件だけ返す（ビルドを落とさない）", () => {
        expect(withPlaceholderParam([], "category")).toEqual([{ category: EMPTY_PARAM_PLACEHOLDER }]);
    });

    it("1件以上あればそのまま返す（ダミーを混ぜない）", () => {
        const params = [{ category: "landscape" }, { category: "nature" }];
        expect(withPlaceholderParam(params, "category")).toBe(params);
    });

    it("キー名は呼び出し側が決める", () => {
        expect(withPlaceholderParam([], "id")).toEqual([{ id: EMPTY_PARAM_PLACEHOLDER }]);
        expect(withPlaceholderParam([], "tag")).toEqual([{ tag: EMPTY_PARAM_PLACEHOLDER }]);
    });

    it("ダミーの値は実データと衝突しにくい形にする", () => {
        // slug は小文字化された利用者の入力、写真IDは UUID、ユーザーIDは Cognito の sub。
        // 先頭のアンダースコアはそのどれとしても現れない。
        expect(EMPTY_PARAM_PLACEHOLDER.startsWith("_")).toBe(true);
    });

    it("値そのものを固定する（.mjs 側がリテラルで参照しているため）", () => {
        // scripts/e2e-smoke.mjs はこの定数を import できず "_none.html" と
        // 直書きしてスモーク対象から除外している。改名するとフィルタが
        // 空振りしてスモークが空枠ページを開くので、ここで連動を固定する。
        expect(EMPTY_PARAM_PLACEHOLDER).toBe("_none");
    });
});
