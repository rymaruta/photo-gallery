import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require("../attach-post-confirmation.js") as {
    planAttach: (a: { attachedArn: string; expectedArn: string; sameNamePoolIds: string[] }) => { action: "none" | "attach" | "replace"; warnings: string[] };
    buildUpdateParams: (pool: Record<string, unknown>, arn: string) => Record<string, unknown>;
    policyAllowsPool: (doc: unknown, poolArn: string) => boolean;
    changedKeys: (before: Record<string, unknown>, after: Record<string, unknown>) => string[];
    expectedFunctionName: (stage: string) => string;
    poolNameForStage: (stage: string) => string;
    READ_ONLY: string[];
    TRIGGER: string;
};
const { planAttach, buildUpdateParams, policyAllowsPool, changedKeys, expectedFunctionName, poolNameForStage, READ_ONLY, TRIGGER } = mod;

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

    // deploy-api.yml の cognitoPoolName と同じ規則。STAGE とプールの組が合わないと止める根拠
    it("環境のプール名は deploy-api.yml と同じ規則", () => {
        expect(poolNameForStage("prod")).toBe("prod-journey-photo-client-spa");
        expect(poolNameForStage("staging")).toBe("staging-journey-photo-client-spa");
    });

    // **READ_ONLY は書き込み可能な項目を1つも含んではいけない。** 含めると
    // UpdateUserPool に渡らず既定値に戻る（削除保護 OFF・確認メールの文面が消える）。
    // 「モジュールの一覧を回す」テストは一覧が膨らんでも自己整合で緑になるので、
    // ここは serverless v3 の一覧をそのままリテラルで縛る
    it("読み取り専用の一覧は serverless v3 と同じ15項目（増やさない）", () => {
        expect([...READ_ONLY].sort()).toEqual([
            "AliasAttributes", "Arn", "CreationDate", "CustomDomain", "Domain",
            "EmailConfigurationFailure", "EstimatedNumberOfUsers", "Id", "LastModifiedDate",
            "Name", "SchemaAttributes", "SmsConfigurationFailure", "Status",
            "UsernameAttributes", "UsernameConfiguration",
        ]);
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
        SmsConfigurationFailure: "x",
        EmailConfigurationFailure: "x",
        CustomDomain: "x",
        UsernameAttributes: [],
        // ここから下は UpdateUserPool に渡せる項目（全部そのまま送り返す）
        Policies: { PasswordPolicy: { MinimumLength: 8, TemporaryPasswordValidityDays: 7 }, SignInPolicy: { AllowedFirstAuthFactors: ["PASSWORD"] } },
        DeletionProtection: "ACTIVE",
        LambdaConfig: { PreSignUp: OTHER },
        AutoVerifiedAttributes: ["email"],
        SmsVerificationMessage: "sms {####}",
        EmailVerificationMessage: "mail {####}",
        EmailVerificationSubject: "subject",
        VerificationMessageTemplate: { DefaultEmailOption: "CONFIRM_WITH_CODE" },
        SmsAuthenticationMessage: "auth {####}",
        UserAttributeUpdateSettings: { AttributesRequireVerificationBeforeUpdate: ["email"] },
        MfaConfiguration: "OFF",
        DeviceConfiguration: { ChallengeRequiredOnNewDevice: false },
        EmailConfiguration: { EmailSendingAccount: "COGNITO_DEFAULT" },
        SmsConfiguration: { SnsCallerArn: "arn:aws:iam::123:role/sns" },
        UserPoolTags: { env: "prod" },
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
        UserPoolAddOns: { AdvancedSecurityMode: "OFF" },
        AccountRecoverySetting: { RecoveryMechanisms: [{ Priority: 1, Name: "verified_email" }] },
        UserPoolTier: "ESSENTIALS",
    };
    /** フィクスチャのうち UpdateUserPool に渡る項目（READ_ONLY を引いた残り） */
    const UPDATABLE = Object.keys(pool).filter((k) => !READ_ONLY.includes(k)).sort();

    it("読み取り専用の項目を全部落とし、UserPoolId を付ける", () => {
        const p = buildUpdateParams(pool, ARN);
        for (const k of READ_ONLY) expect(p, k).not.toHaveProperty(k);
        expect(p.UserPoolId).toBe("ap-northeast-1_AAAA");
    });

    // **送り返す項目の集合そのもの**を見る。READ_ONLY に書き込み可能な項目が
    // 紛れ込むと、ここで「渡していない項目」として現れる
    it("UpdateUserPool に渡せる項目は1つ残らず送り返す（DeletionProtection・UserPoolTier・SMS・確認メールの文面まで）", () => {
        const p = buildUpdateParams(pool, ARN);
        expect(Object.keys(p).sort()).toEqual([...UPDATABLE, "UserPoolId"].sort());
        expect(UPDATABLE).toContain("DeletionProtection");
        expect(UPDATABLE).toContain("UserPoolTier");
        expect(UPDATABLE).toContain("VerificationMessageTemplate");
        expect(UPDATABLE).toContain("SmsConfiguration");
        expect(p.DeletionProtection).toBe("ACTIVE");
        expect(p.UserPoolTier).toBe("ESSENTIALS");
    });

    // **ここが本題。** トリガー以外は1つも変えない
    it("トリガー以外の設定はそのまま送り返す（既定値に戻さない）", () => {
        const p = buildUpdateParams(pool, ARN);
        expect(p.MfaConfiguration).toBe("OFF");
        expect(p.EmailConfiguration).toEqual({ EmailSendingAccount: "COGNITO_DEFAULT" });
        expect(p.UserPoolTags).toEqual({ env: "prod" });
        expect(p.AccountRecoverySetting).toEqual(pool.AccountRecoverySetting);
        expect(p.Policies).toEqual(pool.Policies);
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

describe("付けたあとの読み直し（トリガー以外が変わっていないか）", () => {
    const before = { MfaConfiguration: "OFF", UserPoolTags: { env: "prod" }, LambdaConfig: {}, LastModifiedDate: new Date(0), EstimatedNumberOfUsers: 5 };

    it("トリガー・更新日時・利用者数の変化は数えない", () => {
        expect(changedKeys(before, { ...before, LambdaConfig: { PostConfirmation: ARN }, LastModifiedDate: new Date(1), EstimatedNumberOfUsers: 6 })).toEqual([]);
    });

    // UpdateUserPool が渡さなかった項目を既定値に戻した形（消える・変わる・増える）を全部拾う
    it("消えた・変わった・増えた項目を名前で返す", () => {
        const after = { ...before, MfaConfiguration: "ON", DeletionProtection: "INACTIVE" };
        delete (after as Record<string, unknown>).UserPoolTags;
        expect(changedKeys(before, after)).toEqual(["DeletionProtection", "MfaConfiguration", "UserPoolTags"]);
    });

    it("入れ子の中身の違いも拾う", () => {
        expect(changedKeys(before, { ...before, UserPoolTags: { env: "staging" } })).toEqual(["UserPoolTags"]);
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
