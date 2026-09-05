import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **LEFT-4「削除がエッジに何日残るか」に、診断が答えられていなかった。**
// 出していたのは `cachePolicyId=658327ea-…（TTL はポリシー側）` だけで、
// ID からは秒数が読めない（本番実測 2026-09-05: 5つの behavior のうち
// 4つがこの形だった）。ポリシーを引いて秒で出す。

const require_ = createRequire(import.meta.url);
const { describeBehavior, humanSeconds, residencyNote, UPLOAD_MAX_AGE } = require_("../diagnose-aws.js") as {
    describeBehavior: (b: Record<string, unknown>, p: Map<string, unknown>) => string;
    humanSeconds: (s: unknown) => string;
    residencyNote: () => string[];
    UPLOAD_MAX_AGE: number;
};

const OPTIMIZED = new Map([["p1", {
    name: "Managed-CachingOptimized", MinTTL: 1, DefaultTTL: 86400, MaxTTL: 31536000,
}]]);

describe("CloudFront の TTL の出し方", () => {
    // **1行を丸ごと固定する。** `toContain` の羅列だと
    // **`defaultTTL` と `maxTTL` のラベルを入れ替えても素通り**した
    // （レビューが変異21種で実測。素通り13種）。目的は「maxTTL の秒数を
    // 正しく読ませる」ことなので、どの数がどのラベルに付くかまで見る
    it("ポリシーを引けた行は、この文字列そのもの", () => {
        expect(describeBehavior({ PathPattern: "/uploads/*", CachePolicyId: "p1" }, OPTIMIZED))
            .toBe("  /uploads/*: Managed-CachingOptimized defaultTTL=86400秒（約1日） maxTTL=31536000秒（約365日） minTTL=1秒");
    });

    it("旧式の行も、この文字列そのもの", () => {
        expect(describeBehavior({ PathPattern: "/old/*", DefaultTTL: 3600, MaxTTL: 86400, MinTTL: 0 }, OPTIMIZED))
            .toBe("  /old/*: 旧式 defaultTTL=3600秒（約1時間） maxTTL=86400秒（約1日） minTTL=0秒");
    });

    it("読めなかった行も、この文字列そのもの", () => {
        expect(describeBehavior({ PathPattern: "/x/*", CachePolicyId: "none" }, OPTIMIZED))
            .toBe("  /x/*: cachePolicyId=none（ポリシーを読めなかった＝TTL 不明）");
    });

    it("ポリシーを引けたら秒と日で出す（ID だけで終わらせない）", () => {
        const out = describeBehavior({ PathPattern: "/uploads/*", CachePolicyId: "p1" }, OPTIMIZED);
        expect(out).toContain("/uploads/*");
        expect(out).toContain("Managed-CachingOptimized");
        expect(out, "maxTTL の秒が出ていない").toContain("31536000");
        expect(out, "日に直していない（ID だけ出していた頃と同じ）").toContain("約365日");
        expect(out).not.toContain("TTL はポリシー側");
    });

    // **読めなかったことを「ポリシー側」で誤魔化さない**（分かっていない、と書く）
    it("ポリシーを読めなかったら「不明」と書く", () => {
        const out = describeBehavior({ PathPattern: "/x/*", CachePolicyId: "none" }, OPTIMIZED);
        expect(out).toContain("TTL 不明");
    });

    // 既定の behavior は PathPattern を持たない
    it("既定の behavior は (default) と出す", () => {
        expect(describeBehavior({ CachePolicyId: "p1" }, OPTIMIZED)).toContain("(default)");
    });

    // 旧式（behavior に直接 TTL を書く形）も読めるままにしておく
    it("旧式の behavior はその値をそのまま出す", () => {
        const out = describeBehavior({ PathPattern: "/old/*", DefaultTTL: 3600, MaxTTL: 86400, MinTTL: 0 }, OPTIMIZED);
        expect(out).toContain("旧式");
        expect(out).toContain("3600");
        expect(out).toContain("約1時間");
    });

    it.each([
        [0, "0秒"],
        [59, "59秒"],
        [3600, "約1時間"],
        [86400, "約1日"],
        [31536000, "約365日"],
    ])("%s 秒を読める形にする", (sec, expected) => {
        expect(humanSeconds(sec)).toContain(expected);
    });

    it("数でない値は ? にする（NaN 秒と書かない）", () => {
        expect(humanSeconds(undefined)).toBe("?");
        expect(humanSeconds("86400")).toBe("?");
    });
});

// **この行は本番の診断ログに印字される断定**。一度ここに
// 「削除経路に CreateInvalidation は無い」と書いて出したが誤りだった
// （退会・ストーリー削除・期限切れ掃除には前からある）。
// 文面を変えたらここが落ちる。
describe("残存期間の解釈（LEFT-4）", () => {
    it("エッジの掃除がある経路と無い経路を、名指しで書く", () => {
        const text = residencyNote().join("\n");
        expect(text, "誤った断定に戻っている").not.toContain("削除経路に CreateInvalidation は");
        for (const path of ["退会", "ストーリー削除", "期限切れ掃除", "自分の写真削除"]) {
            expect(text, `掃除がある経路 ${path} を落としている`).toContain(path);
        }
        expect(text, "掃除が無い経路（管理API）を名指ししていない").toContain("管理APIの deletePhoto");
        expect(text).toContain(`max-age=${UPLOAD_MAX_AGE}`);
    });

    // **二重管理の突き合わせ。** 秒数は診断・`api-user/src/upload.ts`・
    // `api/src/upload.ts` の3か所にある。片方を変えても診断は黙って
    // 古い値を言い続けるので、ソースを読んで揃っていることを見る
    it.each([
        ["api-user/src/upload.ts"],
        ["api/src/upload.ts"],
    ])("%s の Cache-Control と同じ秒数を使っている", (rel) => {
        const src = readFileSync(join(__dirname, "..", "..", rel), "utf8");
        const m = src.match(/CacheControl:\s*"max-age=(\d+)"/);
        expect(m, `${rel} に max-age の指定が無い（経路が変わった？）`).not.toBeNull();
        expect(Number(m![1]), "診断が言う秒数とアップロード側がずれている").toBe(UPLOAD_MAX_AGE);
    });
});
