import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Apple でサインイン（2026-10-21）の配線を縛る。
 *
 * - **Apple の鍵（SSM の `/journey-photo/<stage>/apple-signin/*`）を読めるのは `revokeAppleSignIn` だけ**
 *   （`weatherKitKeyScope.test.ts` と同じ考え。共有のロールに足すと、未認証の口を含む全関数が鍵を読める）
 * - 未認証の入口 `appleSignIn` は**専用の狭いロール**（写真テーブル・S3・削除を持たない）
 * - カスタム認証のトリガー3本は**ログだけ**のロール
 * - Bundle ID は既定値を置かない（空なら止まる）
 */
const ROOT = join(__dirname, "..", "..");
const strip = (s: string) => s.replace(/^\s*#.*$/gm, "");

function sections(file: string) {
    const yml = readFileSync(join(ROOT, file), "utf8");
    const [provider, rest] = yml.split(/\nfunctions:\n/);
    const fnSection = rest.split(/\n(?=[a-zA-Z#])/)[0];
    const fns = new Map<string, string>();
    for (const part of ("\n" + fnSection).split(/\n(?=  \w+:\n)/)) {
        const m = /^\n?  (\w+):/.exec(part);
        if (m) fns.set(m[1], strip(part));
    }
    const role = (name: string) => {
        const i = yml.indexOf(`\n    ${name}:\n`);
        if (i < 0) return "";
        const after = yml.slice(i + 1);
        const next = after.slice(1).search(/\n    [A-Z]\w+:\n/);
        return strip(next < 0 ? after : after.slice(0, next + 1));
    };
    return { yml, provider: strip(provider), fns, role };
}

describe("api-user: Apple の鍵は取り消しの口だけが読む", () => {
    const { provider, fns, role } = sections("api-user/serverless.yml");
    const r = role("AppleRevokeRole");

    it("関数とロールを読み取れている", () => {
        expect(fns.has("revokeAppleSignIn")).toBe(true);
        expect(r).toContain("AWS::IAM::Role");
    });

    it("共有のロール・全関数の環境には置かない", () => {
        expect(provider).not.toMatch(/apple-signin|APPLE_SIGNIN_/);
    });

    it("鍵の道を知っていて、そのロールを使うのは revokeAppleSignIn だけ", () => {
        const users = [...fns].filter(([, b]) => /role:\s*AppleRevokeRole/.test(b)).map(([n]) => n);
        expect(users).toEqual(["revokeAppleSignIn"]);
        const knows = [...fns].filter(([, b]) => b.includes("apple-signin")).map(([n]) => n);
        expect(knows).toEqual(["revokeAppleSignIn"]);
    });

    it("ロールの SSM は自分のステージの apple-signin の下を読むだけ・ほかの資源に触らない", () => {
        expect([...new Set(r.match(/ssm:\w+/g) ?? [])]).toEqual(["ssm:GetParameters"]);
        expect(r).toContain("parameter/journey-photo/${sls:stage}/apple-signin/*");
        expect(r).not.toMatch(/weatherkit|dynamodb:|s3:|cognito-idp:|cloudfront:/);
    });

    it("WeatherKit のロールは Apple の鍵を読めない（逆も同じ）", () => {
        expect(role("LightForecastRole")).not.toContain("apple-signin");
    });

    it("認証つきの口で、client_id はそのステージの Bundle ID", () => {
        const b = fns.get("revokeAppleSignIn")!;
        expect(b).toMatch(/path: \/user\/apple\/revoke[\s\S]*authorizer:\s*\n\s*name: cognitoAuthorizer/);
        expect(b).toContain("APPLE_CLIENT_ID: ${param:appStoreBundleId, ''}");
    });
});

describe("api: Apple でサインインの入口とトリガー", () => {
    const { provider, fns, role } = sections("api/serverless.yml");

    it("入口は未認証・専用のロール。写真テーブル・S3・削除を持たない", () => {
        const b = fns.get("appleSignIn")!;
        expect(b).toMatch(/role:\s*AppleSignInRole/);
        expect(b).toMatch(/path: \/auth\/apple\s*\n\s*method: POST/);
        expect(b).not.toContain("authorizer");
        const r = role("AppleSignInRole");
        expect(r).toContain("AWS::IAM::Role");
        expect(r).not.toMatch(/photosTable|s3:|DeleteItem|AdminDeleteUser|ssm:/);
        expect(r).toContain("userpool/${param:cognitoUserPoolId}");
    });

    it("トリガー3本は existing のプールに付き、ログだけのロール", () => {
        for (const [fn, trigger] of [["defineAuthChallenge", "DefineAuthChallenge"], ["createAuthChallenge", "CreateAuthChallenge"],
            ["verifyAuthChallengeResponse", "VerifyAuthChallengeResponse"]]) {
            const b = fns.get(fn)!;
            expect(b, fn).toMatch(/role:\s*CognitoChallengeRole/);
            expect(b, fn).toMatch(new RegExp(`trigger: ${trigger}\\s*\\n\\s*existing: true`));
        }
        const r = role("CognitoChallengeRole");
        expect(r).toContain("logs:PutLogEvents");
        expect(r).not.toMatch(/dynamodb:|s3:|cognito-idp:|ssm:/);
    });

    it("Bundle ID に既定値を置かない・共有の環境にも置かない", () => {
        expect(fns.get("appleSignIn")).toContain("APPLE_BUNDLE_IDS: ${param:appleBundleIds, ''}");
        expect(fns.get("verifyAuthChallengeResponse")).toContain("APPLE_BUNDLE_IDS: ${param:appleBundleIds, ''}");
        expect(provider).not.toContain("APPLE_BUNDLE_IDS");
    });

    it("デプロイが Bundle ID（APNs の topic）を渡す", () => {
        const wf = readFileSync(join(ROOT, ".github", "workflows", "deploy-api.yml"), "utf8");
        expect(wf).toContain("APPLE_BUNDLE_IDS: ${{ needs.config.outputs.apnsTopic }}");
        expect(wf).toContain('extra+=(--param "appleBundleIds=$APPLE_BUNDLE_IDS")');
    });
});
