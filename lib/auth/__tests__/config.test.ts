import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NEXT_PUBLIC_ 環境変数はモジュール読み込み時に評価されるため、
// 各テストで resetModules + 動的 import して評価し直す。

// 本番値へのフォールバックは廃止した。値が無い・不正なら空になる。
// 以前は本番へフォールバックしており、staging のビルドで値を渡し忘れると
// 本番のユーザープールで認証されてしまう状態だった。

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

    it("未設定なら空（本番へフォールバックしない）", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", "");
        expect((await loadConfig()).userPoolId).toBe("");
    });

    it("末尾に改行(CRLF)が混じっていても trim して使う", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", "us-east-1_AbCdEf123\r\n");
        expect((await loadConfig()).userPoolId).toBe("us-east-1_AbCdEf123");
    });

    it("前後の空白は trim される", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", "  us-east-1_AbCdEf123  ");
        expect((await loadConfig()).userPoolId).toBe("us-east-1_AbCdEf123");
    });

    it("不正形式（アンダースコアなし）なら空", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", "not-a-pool-id");
        expect((await loadConfig()).userPoolId).toBe("");
    });

    it("不正形式（引用符混入）なら空", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", '"us-east-1_AbCdEf123"');
        expect((await loadConfig()).userPoolId).toBe("");
    });
});

describe("cognitoConfig - clientId の形式検証", () => {
    it("正しい形式の環境変数はそのまま使う", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "abc123def456");
        expect((await loadConfig()).clientId).toBe("abc123def456");
    });

    it("未設定なら空（本番へフォールバックしない）", async () => {
        vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "");
        expect((await loadConfig()).clientId).toBe("");
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
