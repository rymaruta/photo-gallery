import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NEXT_PUBLIC_ 環境変数はモジュール読み込み時に評価されるため、
// 各テストで resetModules + 動的 import して評価し直す。

const PROD_POOL_ID = "ap-northeast-1_ZbuhDQsWz";
const PROD_CLIENT_ID = "21cs4cd8dkttmg3snloj72u8mu";

async function loadConfig() {
    const mod = await import("../config");
    return mod.cognitoConfig;
}

beforeEach(() => {
    vi.resetModules();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("cognitoConfig - userPoolId の形式検証", () => {
    it("正しい形式の環境変数はそのまま使う", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", "us-east-1_AbCdEf123");
        expect((await loadConfig()).userPoolId).toBe("us-east-1_AbCdEf123");
    });

    it("未設定なら本番の値にフォールバック", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", "");
        expect((await loadConfig()).userPoolId).toBe(PROD_POOL_ID);
    });

    it("末尾に改行(CRLF)が混じっていても trim して使う", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", "us-east-1_AbCdEf123\r\n");
        expect((await loadConfig()).userPoolId).toBe("us-east-1_AbCdEf123");
    });

    it("前後の空白は trim される", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", "  us-east-1_AbCdEf123  ");
        expect((await loadConfig()).userPoolId).toBe("us-east-1_AbCdEf123");
    });

    it("不正形式（アンダースコアなし）ならフォールバック", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", "not-a-pool-id");
        expect((await loadConfig()).userPoolId).toBe(PROD_POOL_ID);
    });

    it("不正形式（引用符混入）ならフォールバック", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", '"ap-northeast-1_ZbuhDQsWz"');
        expect((await loadConfig()).userPoolId).toBe(PROD_POOL_ID);
    });
});

describe("cognitoConfig - clientId の形式検証", () => {
    it("正しい形式の環境変数はそのまま使う", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "abc123def456");
        expect((await loadConfig()).clientId).toBe("abc123def456");
    });

    it("未設定なら本番の値にフォールバック", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "");
        expect((await loadConfig()).clientId).toBe(PROD_CLIENT_ID);
    });

    it("改行混入は trim して使う", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "abc123def456\n");
        expect((await loadConfig()).clientId).toBe("abc123def456");
    });
});

describe("cognitoConfig - region", () => {
    it("未設定なら ap-northeast-1", async () => {
        vi.stubEnv("NEXT_PUBLIC_AWS_REGION", "");
        expect((await loadConfig()).region).toBe("ap-northeast-1");
    });
});
