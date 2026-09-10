import { describe, it, expect } from "vitest";
import { staticPageState, withStaticPageNotice, toastWithStaticPage, STATIC_NOTICE_TOAST_MS } from "../staticPage";

// 「消したのに、検索から開けるページはまだ残っている」を伝える一文。
// 本番は再ビルドのトークンが未設定なので、非公開・削除のたびに残る

describe("印の読み取り", () => {
    it("印が真値でも boolean でなければ拾わない（サーバーの形が変わったら黙る）", () => {
        expect(staticPageState({ staticStale: "true" })).toBe("fresh");
        expect(staticPageState({ staticStale: 1 })).toBe("fresh");
    });

    it("応答が読めなくても投げない", () => {
        for (const v of [null, undefined, "", 0, [], "staticStale"]) {
            expect(staticPageState(v), String(v)).toBe("fresh");
        }
    });
});

// 公開のまま項目を消した保存。ページ自体は残ってよいが、**消した中身が**残る
describe("staticPageState", () => {
    it("3つの状態を見分ける", () => {
        expect(staticPageState({ success: true })).toBe("fresh");
        expect(staticPageState({ success: true, staticStale: true })).toBe("pending");
        expect(staticPageState({ success: true, staticOutdated: true })).toBe("outdated");
    });

    // サーバーは両方を同時に立てない（排他）が、画面側がそれに寄りかからない
    // ようにしておく（形が変わったときに黙って壊れない）
    it("両方立っていたら「まだ取れる」を返す", () => {
        expect(staticPageState({ staticStale: true, staticOutdated: true })).toBe("pending");
    });

    it("読めない応答は fresh（黙る）", () => {
        for (const v of [null, undefined, "", 0, [], { staticOutdated: "true" }]) {
            expect(staticPageState(v), String(v)).toBe("fresh");
        }
    });
});

describe("withStaticPageNotice: 消した中身が残るとき", () => {
    it("「消した内容が残る」と言う（「ページが残る」とは別の話）", () => {
        const ja = withStaticPageNotice("保存しました", "outdated", true);
        expect(ja).toContain("消した内容");
        expect(ja).toContain("残ることがあります");
        expect(ja, "隠したときの文言を流用している").not.toContain("個別ページは、次のサイト更新まで残る");
        expect(withStaticPageNotice("Saved", "outdated", false)).toContain("What you removed");
    });

    it("消した中身が残るときも、読む時間を伸ばす", () => {
        const calls: unknown[][] = [];
        toastWithStaticPage((...a) => calls.push(a), "保存しました", { success: true, staticOutdated: true }, true);
        expect(String(calls[0][0])).toContain("消した内容");
        expect(calls[0][2]).toBe(STATIC_NOTICE_TOAST_MS);
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
        expect(withStaticPageNotice("非公開にしました", "fresh", true)).toBe("非公開にしました");
        expect(withStaticPageNotice("Unpublished", "fresh", false)).toBe("Unpublished");
    });

    it("印があれば一文を足す（「必ず残る」とは言わない）", () => {
        const ja = withStaticPageNotice("非公開にしました", "pending", true);
        expect(ja).toContain("非公開にしました");
        expect(ja).toContain("残ることがあります");
        // 言い切らない——まとめられた依頼は先のビルドが拾うことが多い。
        // 句点で見ていた頃は「必ず残ります」でも通っていた
        // 3つ目の項を `残ります(?!。?$)` と書いていたが、文末の「残ります。」を
        // 通してしまい**名前どおりの仕事をしていなかった**（実際に止めていたのは
        // 次の行）。素直な形に直す
        expect(ja).not.toMatch(/必ず|確実に|残ります/);
        expect(ja).toMatch(/ことがあります/);
        expect(withStaticPageNotice("Photo deleted", "pending", false)).toContain("until the next site update");
    });
});
