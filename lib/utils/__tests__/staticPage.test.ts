import { describe, it, expect } from "vitest";
import { staticPagePending, withStaticPageNotice } from "../staticPage";

// 「消したのに、検索から開けるページはまだ残っている」を伝える一文。
// 本番は再ビルドのトークンが未設定なので、非公開・削除のたびに残る

describe("staticPagePending", () => {
    it("サーバーの印が立っているときだけ true", () => {
        expect(staticPagePending({ success: true, staticStale: true })).toBe(true);
        expect(staticPagePending({ success: true })).toBe(false);
        expect(staticPagePending({ success: true, staticStale: false })).toBe(false);
    });

    it("印が真値でも boolean でなければ拾わない（サーバーの形が変わったら黙る）", () => {
        expect(staticPagePending({ staticStale: "true" })).toBe(false);
        expect(staticPagePending({ staticStale: 1 })).toBe(false);
    });

    it("応答が読めなくても投げない", () => {
        for (const v of [null, undefined, "", 0, [], "staticStale"]) {
            expect(staticPagePending(v), String(v)).toBe(false);
        }
    });
});

describe("withStaticPageNotice", () => {
    it("印が無ければ文言を変えない", () => {
        expect(withStaticPageNotice("非公開にしました", false, true)).toBe("非公開にしました");
        expect(withStaticPageNotice("Unpublished", false, false)).toBe("Unpublished");
    });

    it("印があれば一文を足す（「必ず残る」とは言わない）", () => {
        const ja = withStaticPageNotice("非公開にしました", true, true);
        expect(ja).toContain("非公開にしました");
        expect(ja).toContain("残ることがあります");
        // 言い切らない——まとめられた依頼は先のビルドが拾うことが多い
        expect(ja).not.toContain("残ります。");
        expect(withStaticPageNotice("Photo deleted", true, false)).toContain("until the next site update");
    });
});
