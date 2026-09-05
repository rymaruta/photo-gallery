import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

// **LEFT-4「削除がエッジに何日残るか」に、診断が答えられていなかった。**
// 出していたのは `cachePolicyId=658327ea-…（TTL はポリシー側）` だけで、
// ID からは秒数が読めない（本番実測 2026-09-05: 5つの behavior のうち
// 4つがこの形だった）。ポリシーを引いて秒で出す。

const require_ = createRequire(import.meta.url);
const { describeBehavior, humanSeconds } = require_("../diagnose-aws.js") as {
    describeBehavior: (b: Record<string, unknown>, p: Map<string, unknown>) => string;
    humanSeconds: (s: unknown) => string;
};

const OPTIMIZED = new Map([["p1", {
    name: "Managed-CachingOptimized", MinTTL: 1, DefaultTTL: 86400, MaxTTL: 31536000,
}]]);

describe("CloudFront の TTL の出し方", () => {
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
