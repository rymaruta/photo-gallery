import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const setup = require("../setup-apple-signin.js");
const attach = require("../attach-post-confirmation.js");

const client = {
    UserPoolId: "pool-1", ClientId: "c-1", ClientName: "staging-journey-photo-client-spa",
    ClientSecret: undefined, LastModifiedDate: "2026-01-01", CreationDate: "2025-01-01",
    ExplicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
    PreventUserExistenceErrors: "ENABLED", RefreshTokenValidity: 30, TokenValidityUnits: { RefreshToken: "days" },
    EnableTokenRevocation: true, AuthSessionValidity: 3,
};

describe("setup-apple-signin: クライアントの更新", () => {
    it("ALLOW_CUSTOM_AUTH を足し、ほかの書ける項目はそのまま送り返す（渡さないと既定値に戻る）", () => {
        const { params, changes } = setup.planClientUpdate(client);
        expect(changes).toEqual(["ExplicitAuthFlows", "WriteAttributes"]);
        expect(params.ExplicitAuthFlows).toEqual(["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_CUSTOM_AUTH"]);
        expect(params).toMatchObject({
            UserPoolId: "pool-1", ClientId: "c-1", ClientName: client.ClientName, PreventUserExistenceErrors: "ENABLED",
            RefreshTokenValidity: 30, TokenValidityUnits: { RefreshToken: "days" }, EnableTokenRevocation: true, AuthSessionValidity: 3,
        });
        // 読むだけの項目は送らない
        expect(params).not.toHaveProperty("LastModifiedDate");
        expect(params).not.toHaveProperty("CreationDate");
    });

    it("済んでいれば何もしない", () => {
        expect(setup.planClientUpdate({
            ...client, ExplicitAuthFlows: [...client.ExplicitAuthFlows, "ALLOW_CUSTOM_AUTH"], WriteAttributes: ["email"],
        }).changes).toEqual([]);
    });

    it("読める属性を絞っているときだけ custom:apple_sub を足す（ID トークンに入れる）", () => {
        expect(setup.planClientUpdate({ ...client, ReadAttributes: ["email"] }).params.ReadAttributes).toEqual(["email", "custom:apple_sub"]);
        expect(setup.planClientUpdate(client).params).not.toHaveProperty("ReadAttributes");
    });

    // 🔴 書けるままだと、一時的にログインを奪った人が自分の Apple の sub を書き込み、裏口として残せる
    it("一覧が無い（全部書ける）クライアントは、アプリが書く属性だけにする（custom:apple_sub を書かせない）", () => {
        const { params, changes } = setup.planClientUpdate(client);
        expect(changes).toContain("WriteAttributes");
        expect(params.WriteAttributes).toEqual(["email"]);
        expect(params.WriteAttributes).not.toContain("custom:apple_sub");
        expect(setup.APP_WRITES).toEqual(["email"]);
    });

    it("絞っている一覧からは custom:apple_sub だけを外し、ほかは残す", () => {
        const { params } = setup.planClientUpdate({ ...client, WriteAttributes: ["email", "name", "custom:apple_sub"] });
        expect(params.WriteAttributes).toEqual(["email", "name"]);
    });

    it("プールの必須の属性は書ける一覧に入れる（登録で要る）", () => {
        const pool = { SchemaAttributes: [{ Name: "email", Required: false }, { Name: "name", Required: true }] };
        expect(setup.planClientUpdate(client, pool).params.WriteAttributes).toEqual(["email", "name"]);
    });

    it("読み直したときの狙っていない変化を見つける", () => {
        const after = { ...client, ExplicitAuthFlows: ["x"], LastModifiedDate: "later", PreventUserExistenceErrors: "LEGACY" };
        expect(setup.unexpectedClientChanges(client, after, ["ExplicitAuthFlows"])).toEqual(["PreventUserExistenceErrors"]);
    });

    it("属性があるかを見る", () => {
        expect(setup.hasAppleAttribute({ SchemaAttributes: [{ Name: "email" }, { Name: "custom:apple_sub" }] })).toBe(true);
        expect(setup.hasAppleAttribute({ SchemaAttributes: [{ Name: "email" }] })).toBe(false);
    });
});

describe("attach-post-confirmation: Apple のトリガー3本も付けられる", () => {
    it("トリガーごとの関数の名前", () => {
        expect(attach.expectedFunctionName("staging")).toBe("photo-gallery-api-staging-postConfirmation");
        expect(attach.expectedFunctionName("prod", "DefineAuthChallenge")).toBe("photo-gallery-api-prod-defineAuthChallenge");
        expect(attach.expectedFunctionName("prod", "CreateAuthChallenge")).toBe("photo-gallery-api-prod-createAuthChallenge");
        expect(attach.expectedFunctionName("prod", "VerifyAuthChallengeResponse")).toBe("photo-gallery-api-prod-verifyAuthChallengeResponse");
        expect(() => attach.expectedFunctionName("prod", "PreSignUp")).toThrow(/扱えません/);
    });

    it("付けるのは選んだトリガーだけで、ほかのトリガーは残す", () => {
        const pool = { Id: "pool-1", LambdaConfig: { PostConfirmation: "arn:pc" } };
        const p = attach.buildUpdateParams(pool, "arn:define", "DefineAuthChallenge");
        expect(p.LambdaConfig).toEqual({ PostConfirmation: "arn:pc", DefineAuthChallenge: "arn:define" });
    });

    it("関数の名前は api/serverless.yml の関数と同じ", async () => {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const yml = readFileSync(join(__dirname, "..", "..", "api", "serverless.yml"), "utf8");
        for (const [trigger, fn] of Object.entries(attach.TRIGGER_FUNCTIONS as Record<string, string>)) {
            expect(yml, trigger).toMatch(new RegExp(`\\n  ${fn}:\\n[\\s\\S]*?trigger: ${trigger}\\n`));
        }
    });
});
