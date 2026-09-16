import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require("../attach-post-confirmation.js") as {
    planAttach: (a: { attachedArn: string; expectedArn: string; sameNamePoolIds: string[] }) => { action: "none" | "attach" | "replace"; warnings: string[] };
    buildUpdateParams: (pool: Record<string, unknown>, arn: string) => Record<string, unknown>;
    policyAllowsPool: (doc: unknown, poolArn: string) => boolean;
    expectedFunctionName: (stage: string) => string;
    READ_ONLY: string[];
    TRIGGER: string;
};
const { planAttach, buildUpdateParams, policyAllowsPool, expectedFunctionName, READ_ONLY, TRIGGER } = mod;

const ARN = "arn:aws:lambda:ap-northeast-1:123:function:photo-gallery-api-prod-postConfirmation";
const OTHER = "arn:aws:lambda:ap-northeast-1:123:function:photo-gallery-api-staging-postConfirmation";
const POOL_ARN = "arn:aws:cognito-idp:ap-northeast-1:123:userpool/ap-northeast-1_AAAA";

/**
 * **本番のプールを UpdateUserPool で触る道具。** `UpdateUserPool` は渡さなかった
 * 項目を既定値に戻すので、いちばん怖いのは「トリガーは付いたが MFA や
 * メール設定が消えた」。組み立てを純関数で直接見る。
 */
describe("attach-post-confirmation の判断", () => {
    it("期待する関数名は diagnose と同じ形", () => {
        expect(expectedFunctionName("prod")).toBe("photo-gallery-api-prod-postConfirmation");
        expect(TRIGGER).toBe("PostConfirmation");
    });

    it("何も付いていなければ付ける・同じなら何もしない・別の関数なら付け替える", () => {
        expect(planAttach({ attachedArn: "", expectedArn: ARN, sameNamePoolIds: ["a"] }).action).toBe("attach");
        expect(planAttach({ attachedArn: ARN, expectedArn: ARN, sameNamePoolIds: ["a"] }).action).toBe("none");
        expect(planAttach({ attachedArn: OTHER, expectedArn: ARN, sameNamePoolIds: ["a"] }).action).toBe("replace");
    });

    // 同名のプールが2つあると、api のカスタムリソースは名前で探して先頭に付ける。
    // それが「付いていない」の原因になりうるので、名指しで警告する
    it("同じ名前のプールが2つ以上あれば警告する（1つなら黙る）", () => {
        expect(planAttach({ attachedArn: "", expectedArn: ARN, sameNamePoolIds: ["a"] }).warnings).toEqual([]);
        const w = planAttach({ attachedArn: "", expectedArn: ARN, sameNamePoolIds: ["a", "b"] }).warnings;
        expect(w).toHaveLength(1);
        expect(w[0]).toContain("2 個");
        expect(w[0]).toContain("a, b");
    });
});

describe("UpdateUserPool の本文", () => {
    const pool = {
        Id: "ap-northeast-1_AAAA",
        Name: "prod-journey-photo-client-spa",
        Arn: POOL_ARN,
        Status: "Enabled",
        CreationDate: new Date(0),
        LastModifiedDate: new Date(0),
        SchemaAttributes: [{ Name: "email" }],
        AliasAttributes: ["email"],
        EstimatedNumberOfUsers: 5,
        Domain: "x",
        UsernameConfiguration: { CaseSensitive: false },
        Policies: { PasswordPolicy: { MinimumLength: 8, TemporaryPasswordValidityDays: 7 } },
        LambdaConfig: { PreSignUp: OTHER },
        MfaConfiguration: "OFF",
        EmailConfiguration: { EmailSendingAccount: "COGNITO_DEFAULT" },
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
        UserPoolTags: { env: "prod" },
        AccountRecoverySetting: { RecoveryMechanisms: [{ Priority: 1, Name: "verified_email" }] },
    };

    it("読み取り専用の項目を全部落とし、UserPoolId を付ける", () => {
        const p = buildUpdateParams(pool, ARN);
        for (const k of READ_ONLY) expect(p, k).not.toHaveProperty(k);
        expect(p.UserPoolId).toBe("ap-northeast-1_AAAA");
    });

    // **ここが本題。** トリガー以外は1つも変えない
    it("トリガー以外の設定はそのまま送り返す（既定値に戻さない）", () => {
        const p = buildUpdateParams(pool, ARN);
        expect(p.MfaConfiguration).toBe("OFF");
        expect(p.EmailConfiguration).toEqual({ EmailSendingAccount: "COGNITO_DEFAULT" });
        expect(p.UserPoolTags).toEqual({ env: "prod" });
        expect(p.AccountRecoverySetting).toEqual(pool.AccountRecoverySetting);
        expect(p.Policies).toEqual({ PasswordPolicy: { MinimumLength: 8, TemporaryPasswordValidityDays: 7 } });
        expect(p.AdminCreateUserConfig).toEqual({ AllowAdminCreateUserOnly: false });
    });

    it("PostConfirmation だけ差し替え、他のトリガーは残す", () => {
        const p = buildUpdateParams(pool, ARN);
        expect(p.LambdaConfig).toEqual({ PreSignUp: OTHER, PostConfirmation: ARN });
        // 元のオブジェクトは触らない
        expect(pool.LambdaConfig).toEqual({ PreSignUp: OTHER });
    });

    it("LambdaConfig が無いプールでも付く", () => {
        const { LambdaConfig: _drop, ...bare } = pool;
        void _drop;
        expect(buildUpdateParams(bare, ARN).LambdaConfig).toEqual({ PostConfirmation: ARN });
    });

    // 旧項目と新項目を両方送ると API が断る。旧が返ってきたときだけ写して落とす
    it("UnusedAccountValidityDays が返ってきたら TemporaryPasswordValidityDays へ写して落とす", () => {
        const p = buildUpdateParams({
            ...pool,
            Policies: { PasswordPolicy: { MinimumLength: 8 } },
            AdminCreateUserConfig: { AllowAdminCreateUserOnly: false, UnusedAccountValidityDays: 3 },
        }, ARN);
        expect(p.Policies).toEqual({ PasswordPolicy: { MinimumLength: 8, TemporaryPasswordValidityDays: 3 } });
        expect(p.AdminCreateUserConfig).toEqual({ AllowAdminCreateUserOnly: false });
    });

    // serverless は無条件に写すので、旧が無いと新を undefined で潰す（＝既定の7日に戻る）。
    // こちらは旧が無ければ触らない
    it("UnusedAccountValidityDays が無ければ TemporaryPasswordValidityDays を触らない", () => {
        const p = buildUpdateParams(pool, ARN) as { Policies: { PasswordPolicy: { TemporaryPasswordValidityDays?: number } } };
        expect(p.Policies.PasswordPolicy.TemporaryPasswordValidityDays).toBe(7);
    });
});

describe("Cognito からの呼び出し許可の判定", () => {
    const stmt = (over: Record<string, unknown> = {}) => ({
        Effect: "Allow",
        Principal: { Service: "cognito-idp.amazonaws.com" },
        Action: "lambda:InvokeFunction",
        Condition: { ArnLike: { "AWS:SourceArn": POOL_ARN } },
        ...over,
    });

    it("このプールを SourceArn に持つ許可があれば通る", () => {
        expect(policyAllowsPool({ Statement: [stmt()] }, POOL_ARN)).toBe(true);
    });

    // カスタムリソースが**別のプール**に付けた許可では、このプールからは呼べない。
    // diagnose の `policyAllowsCognito` はここを見ていない（SourceArn を読まない）
    it("別のプールを SourceArn に持つ許可では通らない", () => {
        const other = POOL_ARN.replace("AAAA", "BBBB");
        expect(policyAllowsPool({ Statement: [stmt({ Condition: { ArnLike: { "AWS:SourceArn": other } } })] }, POOL_ARN)).toBe(false);
    });

    it("SourceArn の条件が無い許可は通す（広い側）", () => {
        expect(policyAllowsPool({ Statement: [stmt({ Condition: undefined })] }, POOL_ARN)).toBe(true);
    });

    it("Deny・別のサービス・別のアクション・空は通らない", () => {
        expect(policyAllowsPool({ Statement: [stmt({ Effect: "Deny" })] }, POOL_ARN)).toBe(false);
        expect(policyAllowsPool({ Statement: [stmt({ Principal: { Service: "apigateway.amazonaws.com" } })] }, POOL_ARN)).toBe(false);
        expect(policyAllowsPool({ Statement: [stmt({ Action: "lambda:GetFunction" })] }, POOL_ARN)).toBe(false);
        expect(policyAllowsPool({ Statement: [] }, POOL_ARN)).toBe(false);
        expect(policyAllowsPool(undefined, POOL_ARN)).toBe(false);
    });
});
