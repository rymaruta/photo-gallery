import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// CloudWatch Logs の保存期間（2026-10-18・owner の委任）。
//
// `logRetentionInDays` が無いと、serverless が作る関数ごとのロググループは
// **無期限**に残る。ログには利用者 ID（Cognito の sub）が入るので、期限なしで
// 溜めない——90 日にそろえる。
//
// serverless v3 の `mergeIamTemplates` は関数ごとに `AWS::Logs::LogGroup` を作り、
// 関数の `logRetentionInDays` → provider の値の順で `RetentionInDays` に入れる。
// HTTP API のアクセスログ（`provider.logs.httpApi`）を有効にした場合も
// provider の値を使う（`compile/events/http-api.js`）。だから provider に1つ置けば
// **serverless が作る分は全部**にかかる。ここで固定するのは「新しい serverless
// 設定・新しい関数が黙って無期限に戻らない」こと。
//
// ⚠️ **Lambda@Edge（OGP の書き換え）のログはこのテストの外。** CloudFormation の外で
// 作られた関数で、ログは各地域の `/aws/lambda/us-east-1.<関数名>` に**無期限のまま**
// 残る。その期限は owner が別に付ける必要がある。
//
// **YAML パーサは使わない**（`publicLambdaRole.test.ts` と同じ理由——js-yaml は
// どの package.json にも書かれていない推移依存）。
const ROOT = join(__dirname, "..", "..");
const RETENTION_DAYS = 90;

/** リポジトリ内の serverless 設定を全部拾う（node_modules・隠しディレクトリは見ない） */
function serverlessConfigs(dir: string, depth = 0): string[] {
    if (depth > 3) return [];
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".") || name === "out") continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) out.push(...serverlessConfigs(p, depth + 1));
        else if (/^serverless(\.[\w-]+)?\.ya?ml$/.test(name)) out.push(p);
    }
    return out;
}

/** 最上位キー `key:` の本文（次の最上位キーまで）。コメント行は除く */
function topLevelBlock(yml: string, key: string): string {
    const body = yml.split(new RegExp(`\\n${key}:\\n`))[1];
    if (body === undefined) throw new Error(`${key}: が見つからない`);
    return body.split(/\n(?=[a-zA-Z])/)[0].replace(/^\s*#.*$/gm, "");
}

const withoutComments = (yml: string) => yml.replace(/^\s*#.*$/gm, "");

const configs = serverlessConfigs(ROOT);

describe("CloudWatch Logs の保存期間", () => {
    it("serverless 設定を見つけている（api と api-user）", () => {
        const names = configs.map((p) => relative(ROOT, p)).sort();
        expect(names).toEqual(expect.arrayContaining(["api-user/serverless.yml", "api/serverless.yml"]));
    });

    for (const file of configs) {
        const rel = relative(ROOT, file);
        const yml = readFileSync(file, "utf8");

        it(`${rel}: provider.logRetentionInDays が ${RETENTION_DAYS}`, () => {
            const provider = topLevelBlock(yml, "provider");
            const m = /^ {2}logRetentionInDays:\s*(\d+)\s*$/m.exec(provider);
            expect(m?.[1]).toBe(String(RETENTION_DAYS));
        });

        it(`${rel}: 関数ごとに別の期間で上書きしない・ログを切らない`, () => {
            const body = withoutComments(yml);
            // provider の1か所だけ（関数の `logRetentionInDays` は provider より優先される）
            expect(body.match(/logRetentionInDays:/g) ?? []).toHaveLength(1);
            // `disableLogs` はロググループを作らない＝期間の外に出る
            expect(body).not.toMatch(/disableLogs:/);
        });

        it(`${rel}: resources で自前に作るロググループも ${RETENTION_DAYS} 日`, () => {
            const body = withoutComments(yml);
            // `Type: AWS::Logs::LogGroup` の部品を1つずつ切り出して見る（今は0個）
            const parts = body.split(/\n(?= {4}\w+:\n)/).filter((p) => /Type:\s*AWS::Logs::LogGroup/.test(p));
            for (const part of parts) {
                expect(part).toMatch(new RegExp(`RetentionInDays:\\s*${RETENTION_DAYS}\\b`));
            }
        });
    }
});
