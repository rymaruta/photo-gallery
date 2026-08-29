import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// デプロイの設定は「手順どおりに動く限り踏まない」罠を持ちやすい。
// 実際に踏んだ2つを固定する。

describe("serverless の版が、設定と手順で食い違わない", () => {
    // `serverless.yml` は `frameworkVersion: '3'` を宣言しているのに、
    // devDependencies は `^4.0.0`。素の `serverless deploy` を叩くと
    // ローカルの v4 が使われ、版の不一致とライセンスキー要求で落ちる。
    // CI（deploy-api.yml）は `npx serverless@3` を明示しているので、
    // **手順どおりに動く限り踏まない**が、script は罠のまま残っていた。
    it.each(["api/package.json", "api-user/package.json"])(
        "%s の deploy スクリプトは serverless@3 を明示する",
        (p) => {
            const pkg = JSON.parse(read(p)) as { scripts?: Record<string, string> };
            const deploys = Object.entries(pkg.scripts ?? {}).filter(([k]) => k.startsWith("deploy"));
            expect(deploys.length).toBeGreaterThan(0);
            for (const [name, cmd] of deploys) {
                expect(cmd, `${p} の ${name}`).toContain("serverless@3");
            }
        });

    it.each(["api/serverless.yml", "api-user/serverless.yml"])(
        "%s は frameworkVersion 3 のまま（スクリプトと揃っている）",
        (p) => {
            expect(read(p)).toContain("frameworkVersion: '3'");
        });
});

// ルートだけ `npm ci` すると、Node の解決がルートまで遡って
// **出荷されるのと違う版**でテストが走る（uuid はルート 13 / api-user 11）。
// 「テストを通してからデプロイする」という守りが成立しなくなる。
describe("API のテストは、出荷される依存で走る", () => {
    const wf = read(".github/workflows/deploy-api.yml");

    it("test ジョブが api / api-user でも npm ci する", () => {
        const testJob = wf.slice(wf.indexOf("  test:"), wf.indexOf("  deploy-admin-api:"));
        expect(testJob).toContain("working-directory: api\n");
        expect(testJob).toContain("working-directory: api-user\n");
        // 実際にテストを走らせる行があること（順序の前提）
        expect(testJob.indexOf("working-directory: api-user"))
            .toBeLessThan(testJob.indexOf("npx vitest run api api-user"));
    });
});
