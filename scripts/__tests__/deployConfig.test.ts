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
//
// **文字列の一致で見ない。** 最初そう書いたら、`npm ci` を `npm ls` に
// 変えても緑（＝塞いだ穴がまた開いても気づかない）で、`working-directory: api`
// を `./api`（YAML としても Actions としても同値）に変えると落ちる、という
// 逆向きになっていた。YAML として読んで、ステップの組で見る。
describe("API のテストは、出荷される依存で走る", () => {
    const wf = read(".github/workflows/deploy-api.yml");
    // **`test:` ジョブは `config:` に畳まれた**（2026-09-24）。
    // GitHub は**ジョブごとに分単位で切り上げて課金する**ので、5秒で終わる
    // 環境決めだけで毎回1分取られていた。この見張りが見るべきものは
    // 「テストが、出荷される依存で、デプロイの前に走ること」で、
    // それがどのジョブに在るかではない——切り出す先だけを移す。
    const testJob = wf.slice(wf.indexOf("\n  config:"), wf.indexOf("\n  deploy-admin-api:"));

    /**
     * ステップ単位に割る。**YAML パーサは使わない**——`js-yaml` は
     * どの package.json にも書かれていない（vitest/eslint の推移依存に
     * 寄りかかることになる）。ここで要るのは「1つのステップの中に
     * `npm ci` と `working-directory` が揃っているか」だけなので、
     * `      - ` の区切りで割れば足りる。
     */
    const steps = testJob.split(/\n {6}- /).slice(1);
    const dirOf = (step: string) => {
        const m = /working-directory:\s*(\S+)/.exec(step);
        return (m?.[1] ?? "").replace(/^\.\//, "").replace(/\/$/, "");
    };
    const installs = steps.filter((st) => /\brun:\s*npm ci\b/.test(st));

    it.each(["api", "api-user"])("%s でも npm ci する", (dir) => {
        expect(installs.map(dirOf)).toContain(dir);
    });

    it("ルートでも npm ci する（アプリ側のテストが動かなくなる）", () => {
        expect(installs.map(dirOf)).toContain("");
    });

    it("テストを走らせるのは、依存を入れ終わったあと", () => {
        const runIdx = steps.findIndex((st) => /vitest run api api-user/.test(st));
        expect(runIdx).toBeGreaterThan(-1);
        for (const st of installs) {
            expect(steps.indexOf(st), `${dirOf(st) || "(root)"} の npm ci が後ろにある`)
                .toBeLessThan(runIdx);
        }
    });

    // 3つのロックをキャッシュのキーに入れないと、増やした2本は毎回
    // ダウンロードし直しになる（枠が逼迫しているので効く）
    it("3つのロックがキャッシュのキーに入っている", () => {
        for (const lock of ["package-lock.json", "api/package-lock.json", "api-user/package-lock.json"]) {
            expect(testJob).toContain(lock);
        }
    });
});
