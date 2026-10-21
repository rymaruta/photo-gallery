import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { appleClientSecret, resetAppleSignInKey, revokeAppleSignIn, revokeWithCode, subOfIdToken, toAppleSignInKey } from "../appleRevoke";

const mockSsmSend = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-ssm", () => ({
    SSMClient: class { send = mockSsmSend; },
    GetParametersCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
}));

// 読み込んだ時に環境を読むので **import より先に**置く（トップレベルの await は型検査の基準を増やす）
vi.hoisted(() => {
    process.env.APPLE_SIGNIN_PARAM_PREFIX = "/journey-photo/test/apple-signin";
    process.env.APPLE_TEAM_ID = "TEAM123456";
    process.env.APPLE_CLIENT_ID = "com.journeyphoto.JourneyPhoto";
});

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const key = { keyId: "KEYID12345", privateKey: pem };
const idToken = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;
const cfg = { clientId: "com.journeyphoto.JourneyPhoto", clientSecret: "secret" };

describe("client_secret（ES256）", () => {
    it("Apple の形（kid・iss・aud・sub・5分）で、R||S の署名", () => {
        const now = Date.UTC(2026, 9, 21);
        const jwt = appleClientSecret(key, "TEAM123456", "com.journeyphoto.JourneyPhoto", now);
        const [h, p, s] = jwt.split(".");
        expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEYID12345" });
        const payload = JSON.parse(Buffer.from(p, "base64url").toString());
        expect(payload).toEqual({ iss: "TEAM123456", iat: now / 1000, exp: now / 1000 + 300, aud: "https://appleid.apple.com", sub: "com.journeyphoto.JourneyPhoto" });
        const sig = Buffer.from(s, "base64url");
        expect(sig.length).toBe(64);   // DER ではなく生の R||S
        expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)).toBe(true);
    });

    it("鍵の値: 空・読めない鍵は null、1行に貼った改行は戻す", () => {
        expect(toAppleSignInKey("", pem)).toBeNull();
        expect(toAppleSignInKey("K", "not a key")).toBeNull();
        expect(toAppleSignInKey(" K ", pem.replace(/\n/g, "\\n"))).toEqual({ keyId: "K", privateKey: pem.trim() });
    });
});

describe("revokeWithCode", () => {
    it("コードを交換し、本人の Apple ID なら更新トークンを取り消す", async () => {
        const post = vi.fn()
            .mockResolvedValueOnce({ status: 200, body: { refresh_token: "rt-1", id_token: idToken("001.a.1") } })
            .mockResolvedValueOnce({ status: 200, body: "" });
        expect(await revokeWithCode("code-1", "001.a.1", cfg, post)).toBe("revoked");
        expect(post.mock.calls[0]).toEqual(["https://appleid.apple.com/auth/token",
            { client_id: cfg.clientId, client_secret: "secret", code: "code-1", grant_type: "authorization_code" }]);
        expect(post.mock.calls[1]).toEqual(["https://appleid.apple.com/auth/revoke",
            { client_id: cfg.clientId, client_secret: "secret", token: "rt-1", token_type_hint: "refresh_token" }]);
    });

    // 🔴 他人の Apple ID のコードで、他人の許可を取り消させない
    it("Apple の sub が呼んだ人の custom:apple_sub と違えば断る（交換で生まれた更新トークンは取り消してから）", async () => {
        const post = vi.fn()
            .mockResolvedValueOnce({ status: 200, body: { refresh_token: "rt-1", id_token: idToken("002.b.2") } })
            .mockResolvedValueOnce({ status: 200, body: "" });
        expect(await revokeWithCode("code-1", "001.a.1", cfg, post)).toBe("mismatch");
        expect(post).toHaveBeenCalledTimes(2);
        expect(post.mock.calls[1][1]).toMatchObject({ token: "rt-1", token_type_hint: "refresh_token" });
    });

    it("交換を断られた・取り消しを断られたら failed", async () => {
        expect(await revokeWithCode("c", "s", cfg, vi.fn().mockResolvedValueOnce({ status: 400, body: { error: "invalid_grant" } }))).toBe("failed");
        const post = vi.fn()
            .mockResolvedValueOnce({ status: 200, body: { refresh_token: "rt", id_token: idToken("s") } })
            .mockResolvedValueOnce({ status: 400, body: {} });
        expect(await revokeWithCode("c", "s", cfg, post)).toBe("failed");
    });

    it("ID トークンの sub を読む（読めなければ null）", () => {
        expect(subOfIdToken(idToken("x.y.z"))).toBe("x.y.z");
        expect(subOfIdToken("nope")).toBeNull();
        expect(subOfIdToken(undefined)).toBeNull();
    });
});

describe("POST /user/apple/revoke", () => {
    beforeEach(() => { mockSsmSend.mockReset(); resetAppleSignInKey(); });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (claims: Record<string, unknown>, body: unknown) => (revokeAppleSignIn as any)({
        requestContext: { authorizer: { jwt: { claims } } }, body: JSON.stringify(body),
    });

    it("Apple の人でなければ 403（鍵を読みにいかない）", async () => {
        const res = await call({ sub: "u-1" }, { authorizationCode: "c" });
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).code).toBe("not_apple_user");
        expect(mockSsmSend).not.toHaveBeenCalled();
    });

    it("コードが無ければ 400", async () => {
        expect((await call({ "custom:apple_sub": "001.a.1" }, {})).statusCode).toBe(400);
    });

    it("鍵がまだ無ければ 503（アプリは退会を続ける）", async () => {
        mockSsmSend.mockResolvedValueOnce({ Parameters: [], InvalidParameters: ["/journey-photo/test/apple-signin/key-id"] });
        const res = await call({ "custom:apple_sub": "001.a.1" }, { authorizationCode: "c" });
        expect(res.statusCode).toBe(503);
        expect(mockSsmSend.mock.calls[0][0].input).toEqual({
            Names: ["/journey-photo/test/apple-signin/key-id", "/journey-photo/test/apple-signin/private-key"], WithDecryption: true,
        });
    });
});
