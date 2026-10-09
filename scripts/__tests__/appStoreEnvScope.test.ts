import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-10-09: `APPSTORE_ENVIRONMENTS` は **api-user の全関数に配る**（provider.environment）。
//
// プロフィール・メダルを返す関数（`badgeKeys.ts` の `publicSupporter`・`proBadges.ts` の
// `mergeProBadges`）は、この変数に Production が並ぶサーバー（本番）では Sandbox（TestFlight・審査）の
// サポーター番号を公開せず、メダルにしない（`supporter.ts` の `isPrivateSandbox`）。
// 購入の2関数にだけ置くと、ほかの関数は「Sandbox だけのサーバー」と見なして、審査の人の No.1 を
// 本物の No.1 と並べて公開してしまう。**配り忘れても何も落ちない**ので、ここで見張る。

const ROOT = join(__dirname, "..", "..");

describe("api-user: APPSTORE_ENVIRONMENTS は全関数に配る", () => {
    const yml = readFileSync(join(ROOT, "api-user", "serverless.yml"), "utf8");
    const [provider, functions] = yml.split(/\nfunctions:\n/);
    // コメントを潰してから見る（経緯を書いただけで通らないように）
    const strip = (s: string) => s.replace(/^\s*#.*$/gm, "");

    it("provider.environment に置いてある（deploy-api.yml の appStoreEnvironments を読む）", () => {
        expect(strip(provider)).toMatch(/^\s{4}APPSTORE_ENVIRONMENTS:\s*\$\{param:appStoreEnvironments, ''\}\s*$/m);
    });

    it("関数ごとに別の値で上書きしていない（ずれると、関数によって公開する・しないが割れる）", () => {
        expect(strip(functions)).not.toContain("APPSTORE_ENVIRONMENTS");
    });
});
