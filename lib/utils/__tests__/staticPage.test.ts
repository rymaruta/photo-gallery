import { describe, it, expect } from "vitest";
import { staticPagePending, withStaticPageNotice, toastWithStaticPage, STATIC_NOTICE_TOAST_MS } from "../staticPage";

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

describe("toastWithStaticPage", () => {
    it("印が無ければ普段どおり（既定の表示時間のまま）", () => {
        const calls: unknown[][] = [];
        toastWithStaticPage((...a) => calls.push(a), "写真を削除しました", { success: true }, true);
        expect(calls).toEqual([["写真を削除しました", "success"]]);
    });

    it("印があれば一文を足し、読む時間も伸ばす", () => {
        const calls: unknown[][] = [];
        toastWithStaticPage((...a) => calls.push(a), "写真を削除しました", { success: true, staticStale: true }, true);
        expect(calls).toHaveLength(1);
        expect(String(calls[0][0])).toContain("残ることがあります");
        // 45文字を既定の3秒では読み切れない
        expect(calls[0][2]).toBe(STATIC_NOTICE_TOAST_MS);
        expect(STATIC_NOTICE_TOAST_MS).toBeGreaterThan(3000);
    });

    it("応答が読めなかった（null）ときは黙る", () => {
        const calls: unknown[][] = [];
        toastWithStaticPage((...a) => calls.push(a), "写真を削除しました", null, true);
        expect(calls).toEqual([["写真を削除しました", "success"]]);
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
        // 言い切らない——まとめられた依頼は先のビルドが拾うことが多い。
        // 句点で見ていた頃は「必ず残ります」でも通っていた
        expect(ja).not.toMatch(/必ず|確実に|残ります(?!。?$)/);
        expect(ja).toMatch(/ことがあります/);
        expect(withStaticPageNotice("Photo deleted", true, false)).toContain("until the next site update");
    });
});
