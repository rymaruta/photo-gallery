import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { planSignPrivate, assertOnlySigned } = require("../sign-private-behavior.js");

/**
 * 本番の CloudFront の `private/*` に署名必須を付ける道具。
 * **1つ間違えるとサイト全体の画像が割れる**（`uploads/*` に付けた場合）ので、
 * 送る設定の形をここで固定する。
 *
 * 🔴 **経路は先頭に `/` がある形**（`/uploads/*`・`/private/*`）で組む。本番も staging も
 * この形（2026-09-28 の `add-private-behavior` の実行ログ）で、先頭の `/` なしで探していた
 * `setup-private-delivery.sh` の手順3は、既にある `/private/*` を見つけられなかった。
 */
const uploads = {
    PathPattern: "/uploads/*", TargetOriginId: "upload-bucket",
    TrustedKeyGroups: { Enabled: false, Quantity: 0 },
    TrustedSigners: { Enabled: false, Quantity: 0 },
};
const priv = { ...uploads, PathPattern: "/private/*" };
const nextStatic = { PathPattern: "/_next/static/*", TargetOriginId: "site-bucket" };
const config = () => JSON.parse(JSON.stringify({
    Comment: "prod",
    DefaultCacheBehavior: { TargetOriginId: "site-bucket" },
    CacheBehaviors: { Quantity: 3, Items: [nextStatic, uploads, priv] },
}));

describe("private/* に鍵グループを付ける", () => {
    it("先頭に / がある /private/* を見つけ、そこにだけ付ける", () => {
        const plan = planSignPrivate(config(), "KG1");
        expect(plan.status).toBe("sign");
        expect(plan.behavior.PathPattern).toBe("/private/*");
        expect(plan.behavior.TrustedKeyGroups).toEqual({ Enabled: true, Quantity: 1, Items: ["KG1"] });
        expect(plan.config.CacheBehaviors.Quantity, "振る舞いを足していない").toBe(3);
    });

    it("先頭の / が無い書き方でも見つける", () => {
        const c = config();
        c.CacheBehaviors.Items[2].PathPattern = "private/*";
        expect(planSignPrivate(c, "KG1").status).toBe("sign");
    });

    it("🔴 /uploads/* と既定の振る舞い・ほかの設定は1文字も変えない", () => {
        const before = config();
        const plan = planSignPrivate(before, "KG1");
        expect(plan.config.CacheBehaviors.Items[0]).toEqual(before.CacheBehaviors.Items[0]);
        expect(plan.config.CacheBehaviors.Items[1]).toEqual(before.CacheBehaviors.Items[1]);
        expect(plan.config.CacheBehaviors.Items[1].TrustedKeyGroups.Enabled).toBe(false);
        expect(plan.config.DefaultCacheBehavior).toEqual(before.DefaultCacheBehavior);
        expect(plan.config.Comment).toBe("prod");
        expect(before.CacheBehaviors.Items[2].TrustedKeyGroups.Enabled, "元の設定を書き換えている").toBe(false);
    });

    it("/private/* が無ければ足さずに止める（足すのは add-private-behavior だけ）", () => {
        const c = config();
        c.CacheBehaviors.Items = [nextStatic, uploads];
        c.CacheBehaviors.Quantity = 2;
        expect(planSignPrivate(c, "KG1").status).toBe("no-private");
    });

    it("既に同じ鍵グループなら何もしない（二度流しても壊れない）", () => {
        const c = planSignPrivate(config(), "KG1").config;
        expect(planSignPrivate(c, "KG1").status).toBe("already");
    });

    it("別の鍵グループ・古い方式が付いていたら上書きしない", () => {
        const c = planSignPrivate(config(), "KG1").config;
        expect(planSignPrivate(c, "KG2").status).toBe("other-signers");
        const d = config();
        d.CacheBehaviors.Items[2].TrustedSigners = { Enabled: true, Quantity: 1, Items: ["self"] };
        expect(planSignPrivate(d, "KG1").status).toBe("other-signers");
    });

    it("鍵グループの Id が空なら止める", () => {
        expect(() => planSignPrivate(config(), "")).toThrow(/鍵グループ/);
    });

    it("🔴 送る直前の見張りは、/uploads/* に付いていたら止める", () => {
        const before = config();
        const after = JSON.parse(JSON.stringify(before));
        after.CacheBehaviors.Items[1].TrustedKeyGroups = { Enabled: true, Quantity: 1, Items: ["KG1"] };
        expect(() => assertOnlySigned(before, after)).toThrow(/uploads/);
    });

    it("🔴 /private/* の鍵グループ以外（行き先など）が変わっていたら止める", () => {
        const before = config();
        const after = planSignPrivate(before, "KG1").config;
        after.CacheBehaviors.Items[2].TargetOriginId = "site-bucket";
        expect(() => assertOnlySigned(before, after)).toThrow(/鍵グループ以外/);
    });

    it("🔴 振る舞いの数や、振る舞い以外の設定が変わっていたら止める", () => {
        const before = config();
        const added = planSignPrivate(before, "KG1").config;
        added.CacheBehaviors.Items.push({ PathPattern: "private/*" });
        expect(() => assertOnlySigned(before, added)).toThrow(/数/);
        const other = planSignPrivate(before, "KG1").config;
        other.Comment = "x";
        expect(() => assertOnlySigned(before, other)).toThrow(/以外の設定/);
    });
});
