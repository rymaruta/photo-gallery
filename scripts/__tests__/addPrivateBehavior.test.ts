import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { planPrivateBehavior, assertOnlyAdded } = require("../add-private-behavior.js");

/**
 * 本番の CloudFront を書き換える道具。**1つ間違えるとサイト全体の画像が割れる**
 * （`uploads/*` を書き換えた場合）ので、送る設定の形をここで固定する。
 */
const uploads = {
    PathPattern: "/uploads/*", TargetOriginId: "upload-bucket",
    TrustedKeyGroups: { Enabled: false, Quantity: 0 },
    LambdaFunctionAssociations: { Quantity: 0 },
};
const nextStatic = { PathPattern: "/_next/static/*", TargetOriginId: "site-bucket" };
const config = () => ({
    Comment: "prod",
    DefaultCacheBehavior: { TargetOriginId: "site-bucket" },
    CacheBehaviors: { Quantity: 2, Items: [JSON.parse(JSON.stringify(nextStatic)), JSON.parse(JSON.stringify(uploads))] },
});

describe("private/* の振る舞いを足す", () => {
    it("uploads/* を写して、経路だけ private/* にした振る舞いを1つ足す", () => {
        const plan = planPrivateBehavior(config());
        expect(plan.status).toBe("add");
        expect(plan.behavior.PathPattern).toBe("/private/*");
        expect(plan.behavior.TargetOriginId, "静的サイトへ向けると 404 のまま").toBe("upload-bucket");
        expect(plan.config.CacheBehaviors.Quantity).toBe(3);
    });

    it("署名はまだ付けない（鍵が Lambda に入るまで絞った写真が全部 403 になる）", () => {
        expect(planPrivateBehavior(config()).behavior.TrustedKeyGroups.Enabled).toBe(false);
    });

    it("🔴 既存の振る舞い（uploads/* を含む）と、それ以外の設定は1文字も変えない", () => {
        const before = config();
        const plan = planPrivateBehavior(before);
        expect(plan.config.CacheBehaviors.Items.slice(0, 2)).toEqual(before.CacheBehaviors.Items);
        expect(plan.config.DefaultCacheBehavior).toEqual(before.DefaultCacheBehavior);
        expect(plan.config.Comment).toBe("prod");
        expect(before.CacheBehaviors.Quantity, "元の設定を書き換えている").toBe(2);
    });

    it("🔴 送る直前の見張りは、uploads/* が変わっていたら止める", () => {
        const before = config();
        const after = planPrivateBehavior(before).config;
        after.CacheBehaviors.Items[1].TrustedKeyGroups = { Enabled: true, Quantity: 1, Items: ["k"] };
        expect(() => assertOnlyAdded(before, after)).toThrow(/uploads/);
    });

    it("🔴 足す経路が private/* 以外なら止める", () => {
        const before = config();
        const after = planPrivateBehavior(before).config;
        after.CacheBehaviors.Items[2].PathPattern = "/uploads/*";
        expect(() => assertOnlyAdded(before, after)).toThrow(/private/);
    });

    it("既にあれば何もしない（二度流しても壊れない）", () => {
        const c = config();
        c.CacheBehaviors.Items.push({ PathPattern: "private/*", TargetOriginId: "upload-bucket" });
        expect(planPrivateBehavior(c).status).toBe("exists");
    });

    it("uploads/* が無ければ止める（既定を写すと静的サイトへ向いて 404 のまま）", () => {
        const c = config();
        c.CacheBehaviors.Items = [nextStatic];
        expect(planPrivateBehavior(c).status).toBe("no-uploads");
    });

    it("経路の書き方は既存に揃える（先頭の / が無い形）", () => {
        const c = config();
        c.CacheBehaviors.Items[1].PathPattern = "uploads/*";
        expect(planPrivateBehavior(c).behavior.PathPattern).toBe("private/*");
    });
});
