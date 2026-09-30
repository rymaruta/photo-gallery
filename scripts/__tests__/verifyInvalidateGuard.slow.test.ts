import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// **重いテスト（`*.slow.test.ts`）。** `npm test` からは外し、`npm run verify` で
// だけ流す（`vitest.config.ts` の `RUN_SLOW_TESTS`）。正規表現で見る側は
// `verifyInvalidateGuard.test.ts` に残してある。

const ROOT = join(__dirname, "..", "..");

// **実際に走らせる。** 正規表現の検査はいくらでも緑にできるが、
// 「tsx で変換が通るか」は動かさないと分からない（`verify-upload` は
// top-level await を書いて staging で初めて落ちた前例がある）。
// staging でない値を渡せば AWS に触る前に中止するので、安全に起動できる。
function run(env: Record<string, string>) {
    const r = spawnSync("npx", ["tsx", "scripts/verify-invalidate.ts"], {
        cwd: ROOT,
        env: { ...process.env, ...env },
        encoding: "utf8",
    });
    return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status ?? -1 };
}

const STAGING = {
    UPLOAD_BUCKET: "staging-journey-photo-upload",
    PHOTOS_TABLE: "staging-photo-gallery-photos",
    CLOUDFRONT_DISTRIBUTION_ID: "EF2TFEBBP24DL",
    CLEANUP_FUNCTION: "photo-gallery-user-api-staging-cleanupStories",
    ADMIN_DELETE_FUNCTION: "photo-gallery-api-staging-deletePhoto",
};

describe("verify-invalidate を実際に起動する", () => {
    // **片方だけ本番**の組み合わせを1つずつ踏む。前は prod×prod しか
    // 渡しておらず、`PHOTOS_TABLE` の判定を落としても素通りした（実測）
    it.each([
        ["バケットだけ本番", { UPLOAD_BUCKET: "prod-journey-photo-upload" }, /staging 以外では実行しません/],
        ["テーブルだけ本番", { PHOTOS_TABLE: "prod-photo-gallery-photos" }, /staging 以外では実行しません/],
        ["両方本番", { UPLOAD_BUCKET: "prod-journey-photo-upload", PHOTOS_TABLE: "prod-photo-gallery-photos" }, /staging 以外では実行しません/],
        // **invoke 先が本番**——ここが素通りしていた。`--apply` を付ければ
        // 本番の cleanupStories を叩く（本番の期限切れを実際に消す）
        ["掃除の関数だけ本番", { CLEANUP_FUNCTION: "photo-gallery-user-api-prod-cleanupStories" }, /staging 以外の関数は叩きません/],
        ["管理APIの関数だけ本番", { ADMIN_DELETE_FUNCTION: "photo-gallery-api-prod-deletePhoto" }, /staging 以外の関数は叩きません/],
    ])("%s なら、AWS に触る前に中止する", (_name, override, expected) => {
        const { out, code } = run({ ...STAGING, ...override });
        expect(code, "止まっていない").toBe(1);
        expect(out).toMatch(expected);
    });

    it("staging でも --apply が無ければ何も書かない（やることを出すだけ）", () => {
        const { out, code } = run(STAGING);
        expect(code).toBe(0);
        expect(out).toMatch(/ドライラン/);
        expect(out, "資格情報を取りに行っている").not.toMatch(/CredentialsProviderError|InvalidClientTokenId/);
    });
});
