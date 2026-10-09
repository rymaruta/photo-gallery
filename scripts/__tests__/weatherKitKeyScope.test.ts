import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 🔴 **WeatherKit の鍵（SSM パラメータ）を読めるのは、光と天気の知らせの2つの関数だけ。**
 *
 * 鍵は SSM パラメータストアの `/journey-photo/<stage>/weatherkit/*`（owner が画面で作る）。
 * 読む許可を**共有のロール（provider）に足すと、未認証の口を含む全関数が鍵を読める**
 * （`apnsKeyScope.test.ts`・`publicLambdaRole.test.ts` と同じ考え）。
 * だから専用のロール `LightForecastRole` に置き、そのロールを使う関数を名指しで縛る。
 */
const ROOT = join(__dirname, "..", "..");
const yml = readFileSync(join(ROOT, "api-user", "serverless.yml"), "utf8");
const strip = (s: string) => s.replace(/^\s*#.*$/gm, "");
const [provider, rest] = yml.split(/\nfunctions:\n/);
const fnSection = rest.split(/\n(?=[a-zA-Z#])/)[0];

const fns = new Map<string, string>();
for (const part of ("\n" + fnSection).split(/\n(?=  \w+:\n)/)) {
    const m = /^\n?  (\w+):/.exec(part);
    if (m) fns.set(m[1], strip(part));
}

/** resources の `LightForecastRole` の本文 */
const role = (() => {
    const i = yml.indexOf("\n    LightForecastRole:\n");
    if (i < 0) return "";
    const after = yml.slice(i + 1);
    const next = after.slice(1).search(/\n    [A-Z]\w+:\n/);
    return strip(next < 0 ? after : after.slice(0, next + 1));
})();

describe("api-user: WeatherKit の鍵は2つの関数だけが読む", () => {
    it("関数を読み取れている（走査が空振りしていない）", () => {
        expect(fns.size).toBeGreaterThan(30);
        expect(role).toContain("AWS::IAM::Role");
    });

    it("共有のロール・全関数の環境には置かない", () => {
        expect(strip(provider)).not.toMatch(/ssm:|WEATHERKIT_/);
    });

    it("専用のロールを使い、鍵の道を知っているのは2つの関数だけ", () => {
        const users = [...fns].filter(([, b]) => /role:\s*LightForecastRole/.test(b)).map(([n]) => n).sort();
        expect(users).toEqual(["getLightForecast", "sendLightAlerts"]);
        const knows = [...fns].filter(([, b]) => b.includes("WEATHERKIT_PARAM_PREFIX")).map(([n]) => n).sort();
        expect(knows).toEqual(["getLightForecast", "sendLightAlerts"]);
    });

    it("ロールの SSM は自分のステージの weatherkit の下だけ・読むだけ", () => {
        const ssm = role.match(/ssm:\w+/g) ?? [];
        expect([...new Set(ssm)].sort()).toEqual(["ssm:GetParameter", "ssm:GetParameters"]);
        expect(role).toContain("parameter/journey-photo/${sls:stage}/weatherkit/*");
        expect(role).not.toMatch(/Resource:\s*\n\s*-\s*['"]?\*['"]?\s*$/m);
        // 消す・書く権限は持たない
        expect(role).not.toMatch(/dynamodb:DeleteItem|s3:|cloudfront:/);
    });

    it("道の頭は関数の環境と同じ（ステージごと）", () => {
        for (const n of ["getLightForecast", "sendLightAlerts"]) {
            expect(fns.get(n)).toContain("WEATHERKIT_PARAM_PREFIX: /journey-photo/${sls:stage}/weatherkit");
        }
    });

    it("SSM の SDK は CI が入れるルートの依存にもある（テストが読める）", () => {
        const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
        const api = JSON.parse(readFileSync(join(ROOT, "api-user", "package.json"), "utf8"));
        expect({ ...root.dependencies, ...root.devDependencies }["@aws-sdk/client-ssm"]).toBeTruthy();
        expect(api.dependencies["@aws-sdk/client-ssm"]).toBeTruthy();
    });
});
