import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppleIdClaims } from "../appleIdToken";
import {
    decideAppleAccount, filterSafeEmail, livePool, randomPassword, resolveAppleAccount, appleSignIn,
} from "../appleSignIn";

// `cognitoTrigger.ts` は読み込んだ時に USERS_TABLE を読む。**import より先に**置く
// （トップレベルの await を使うと api の型検査の基準（TS1378）が1件増える）
vi.hoisted(() => { process.env.USERS_TABLE = "users-test"; });

const mockCognitoSend = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-cognito-identity-provider", () => {
    const cmd = () => class { input: unknown; constructor(i: unknown) { this.input = i; } };
    return {
        CognitoIdentityProviderClient: class { send = mockCognitoSend; },
        AdminAddUserToGroupCommand: cmd(), CreateGroupCommand: cmd(), ListUsersCommand: cmd(),
        AdminCreateUserCommand: cmd(), AdminSetUserPasswordCommand: cmd(), AdminUpdateUserAttributesCommand: cmd(),
    };
});
vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: class { send = vi.fn().mockResolvedValue({}); },
    PutItemCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
}));
vi.mock("@aws-sdk/util-dynamodb", () => ({ marshall: (v: unknown) => v }));

type Pool = Parameters<typeof resolveAppleAccount>[0];
type PoolUser = Parameters<typeof decideAppleAccount>[0][number];

const SUB = "001234.abcdef0123456789.0123";
const claims = (over: Partial<AppleIdClaims> = {}): AppleIdClaims & { email: string } => ({
    sub: SUB, nonceHash: "h", expiresAtMs: 0, email: "taro@example.com", emailVerified: true, isPrivateEmail: false, ...over,
} as AppleIdClaims & { email: string });
const user = (username: string, status: string, attrs: Record<string, string>): PoolUser =>
    ({ username, status, attrs: { email: "taro@example.com", ...attrs } });

describe("decideAppleAccount（同じメールのアカウントとの関係）", () => {
    it("この Apple ID とつながった人が居れば、その人で入る", () => {
        const me = user("u-1", "CONFIRMED", { email_verified: "true", "custom:apple_sub": SUB });
        expect(decideAppleAccount([me], claims())).toEqual({ kind: "signIn", user: me });
    });

    // 🔴 メールが確認済みでない人の custom:apple_sub は、Apple のメールの持ち主かを確かめていない
    it("この Apple ID とつながっていても、メールが確認済みでなければその人では入らない", () => {
        const unverified = user("u-1", "CONFIRMED", { email_verified: "false", "custom:apple_sub": SUB });
        expect(decideAppleAccount([unverified], claims()).kind).not.toBe("signIn");
    });

    it("メールは大文字小文字をそろえて比べ、違うメールの人は見ない", () => {
        const upper = user("u-2", "CONFIRMED", { email: "Taro@Example.com", email_verified: "true" });
        expect(decideAppleAccount([upper], claims()).kind).toBe("link");
        const other = user("u-3", "CONFIRMED", { email: "jiro@example.com", email_verified: "true", "custom:apple_sub": SUB });
        expect(decideAppleAccount([other], claims())).toEqual({ kind: "create" });
    });

    it("確認済みのメールのアカウントには、つなぐ（新しく作らない）", () => {
        const pw = user("u-2", "CONFIRMED", { email_verified: "true" });
        expect(decideAppleAccount([pw], claims())).toEqual({ kind: "link", user: pw });
    });

    // 🔴 未確認のアカウント（メールを持っていると確かめていない人が作れる）にはつながない
    it("未確認のアカウントしか無ければ、つながずに作る", () => {
        const unconfirmed = user("u-3", "UNCONFIRMED", { email_verified: "false" });
        expect(decideAppleAccount([unconfirmed], claims())).toEqual({ kind: "create" });
        expect(decideAppleAccount([], claims())).toEqual({ kind: "create" });
    });

    it("別の Apple ID とつながったアカウントは乗っ取らない", () => {
        const other = user("u-4", "CONFIRMED", { email_verified: "true", "custom:apple_sub": "009999.x.1" });
        expect(decideAppleAccount([other], claims()).kind).toBe("conflict");
    });

    it("Apple 側のメールが未確認なら、つながない", () => {
        const pw = user("u-2", "CONFIRMED", { email_verified: "true" });
        expect(decideAppleAccount([pw], claims({ emailVerified: false })).kind).toBe("conflict");
    });

    it("パスワードの再設定待ちなど、確認済みでないアカウントにはつながない", () => {
        const reset = user("u-5", "RESET_REQUIRED", { email_verified: "true" });
        expect(decideAppleAccount([reset], claims()).kind).toBe("conflict");
    });
});

function fakePool(users: PoolUser[] = []): Pool & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        listByEmail: vi.fn(async () => users),
        link: vi.fn(async (u: string) => { calls.push(`link:${u}`); }),
        create: vi.fn(async (u: string) => { calls.push(`create:${u}`); return "sub-new"; }),
        setRandomPassword: vi.fn(async (u: string) => { calls.push(`password:${u}`); }),
        welcome: vi.fn(async (u: string, id: string) => { calls.push(`welcome:${u}:${id}`); }),
    };
}

describe("resolveAppleAccount", () => {
    it("作るときは パスワードの確定 → グループとプロフィール まで済ませる", async () => {
        const pool = fakePool();
        const r = await resolveAppleAccount(pool, claims(), () => "new-uuid");
        expect(r).toEqual({ status: 200, username: "new-uuid", created: true, linked: false });
        expect(pool.calls).toEqual(["create:new-uuid", "password:new-uuid", "welcome:new-uuid:sub-new"]);
    });

    it("つなぐときは属性を書くだけ（作らない）", async () => {
        const pool = fakePool([user("u-2", "CONFIRMED", { email_verified: "true" })]);
        expect(await resolveAppleAccount(pool, claims())).toEqual({ status: 200, username: "u-2", created: false, linked: true });
        expect(pool.calls).toEqual(["link:u-2"]);
    });

    it("作った直後にパスワードの確定だけ落ちた人は、次の回に確定し直す", async () => {
        const pool = fakePool([user("u-1", "FORCE_CHANGE_PASSWORD", { email_verified: "true", "custom:apple_sub": SUB })]);
        expect((await resolveAppleAccount(pool, claims())).status).toBe(200);
        expect(pool.calls).toEqual(["password:u-1"]);
    });

    it("同時に作られた（AliasExists）ら1度だけ探し直して、その人で入る", async () => {
        const pool = fakePool();
        const mine = user("u-9", "CONFIRMED", { email_verified: "true", "custom:apple_sub": SUB });
        (pool.listByEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]).mockResolvedValueOnce([mine]);
        (pool.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error("x"), { name: "AliasExistsException" }));
        expect(await resolveAppleAccount(pool, claims(), () => "new-uuid"))
            .toEqual({ status: 200, username: "u-9", created: false, linked: false });
    });

    it("つなげないときは 409（作らない）", async () => {
        const pool = fakePool([user("u-4", "CONFIRMED", { email_verified: "true", "custom:apple_sub": "009999.x.1" })]);
        expect((await resolveAppleAccount(pool, claims())).status).toBe(409);
        expect(pool.calls).toEqual([]);
    });
});

describe("Cognito への頼み方（livePool）", () => {
    beforeEach(() => mockCognitoSend.mockReset());

    it("メールで探し、作るときは招待のメールを送らず・確認済み・apple_sub 付きで作る", async () => {
        mockCognitoSend.mockResolvedValueOnce({ Users: [{ Username: "u-1", UserStatus: "CONFIRMED", Attributes: [{ Name: "email_verified", Value: "true" }] }] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pool = livePool("pool-1", { send: mockCognitoSend } as any);
        expect(await pool.listByEmail("taro@example.com")).toEqual([{ username: "u-1", status: "CONFIRMED", attrs: { email_verified: "true" } }]);
        expect(mockCognitoSend.mock.calls[0][0].input).toMatchObject({ UserPoolId: "pool-1", Filter: 'email = "taro@example.com"' });
        mockCognitoSend.mockReset();

        mockCognitoSend.mockResolvedValueOnce({ User: { Attributes: [{ Name: "sub", Value: "sub-new" }] } });
        expect(await pool.create("new-uuid", "taro@example.com", SUB)).toBe("sub-new");
        const input = mockCognitoSend.mock.calls[0][0].input;
        expect(input.MessageAction).toBe("SUPPRESS");
        expect(input.UserAttributes).toEqual([
            { Name: "email", Value: "taro@example.com" },
            { Name: "email_verified", Value: "true" },
            { Name: "custom:apple_sub", Value: SUB },
        ]);

        mockCognitoSend.mockResolvedValueOnce({});
        await pool.setRandomPassword("new-uuid");
        expect(mockCognitoSend.mock.calls[1][0].input).toMatchObject({ Username: "new-uuid", Permanent: true });
    });

    it("大文字の混じったメールは、元の綴りと小文字の両方で引く（同じ人は1回だけ）", async () => {
        mockCognitoSend
            .mockResolvedValueOnce({ Users: [{ Username: "u-1", Attributes: [] }] })
            .mockResolvedValueOnce({ Users: [{ Username: "u-1", Attributes: [] }, { Username: "u-2", Attributes: [] }] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pool = livePool("pool-1", { send: mockCognitoSend } as any);
        expect((await pool.listByEmail("Taro@Example.com")).map((u) => u.username)).toEqual(["u-1", "u-2"]);
        expect(mockCognitoSend.mock.calls.map((c) => c[0].input.Filter)).toEqual(['email = "Taro@Example.com"', 'email = "taro@example.com"']);
    });

    it("ランダムなパスワードはプールの決まり（大小英字・数字・記号・8字以上）を満たし、毎回違う", () => {
        const a = randomPassword(), b = randomPassword();
        expect(a).not.toBe(b);
        expect(a.length).toBeGreaterThanOrEqual(8);
        expect(a).toMatch(/[A-Z]/);
        expect(a).toMatch(/[a-z]/);
        expect(a).toMatch(/[0-9]/);
        expect(a).toMatch(/[^A-Za-z0-9]/);
    });

    it("絞り込みに入れてはいけないメール（引用符・逆斜線・空白）は断る", () => {
        expect(filterSafeEmail("taro@example.com")).toBe(true);
        expect(filterSafeEmail('a"b@example.com')).toBe(false);
        expect(filterSafeEmail("a\\b@example.com")).toBe(false);
        expect(filterSafeEmail("a b@example.com")).toBe(false);
    });
});

describe("POST /auth/apple（入口）", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (body: unknown) => (appleSignIn as any)({ body: typeof body === "string" ? body : JSON.stringify(body) });

    it("切り替えが off なら、ほかの設定が揃っていても 503（既定は off）", async () => {
        vi.stubEnv("COGNITO_USER_POOL_ID", "pool-1");
        vi.stubEnv("APPLE_BUNDLE_IDS", "com.journeyphoto.JourneyPhoto");
        vi.stubEnv("APPLE_SIGNIN_ENABLED", "");
        const res = await call({ identityToken: "x", nonce: "y" });
        expect(res.statusCode).toBe(503);
        expect(JSON.parse(res.body).code).toBe("apple_signin_off");
    });

    it("設定が無ければ 503（既定値で動かない）", async () => {
        vi.stubEnv("APPLE_SIGNIN_ENABLED", "true");
        vi.stubEnv("COGNITO_USER_POOL_ID", "");
        vi.stubEnv("APPLE_BUNDLE_IDS", "");
        const res = await call({ identityToken: "x", nonce: "y" });
        expect(res.statusCode).toBe(503);
        expect(JSON.parse(res.body).code).toBe("apple_signin_off");
    });

    it("形の違う要求は 400、確かめられないトークンは 401（Cognito に触らない）", async () => {
        vi.stubEnv("COGNITO_USER_POOL_ID", "pool-1");
        vi.stubEnv("APPLE_BUNDLE_IDS", "com.journeyphoto.JourneyPhoto");
        vi.stubEnv("APPLE_SIGNIN_ENABLED", "true");
        mockCognitoSend.mockReset();
        expect((await call("not json")).statusCode).toBe(400);
        expect((await call({ identityToken: 1 })).statusCode).toBe(400);
        const res = await call({ identityToken: "a.b.c", nonce: "raw-nonce-0123456789abcdef" });
        expect(res.statusCode).toBe(401);
        expect(JSON.parse(res.body).code).toBe("apple_token_invalid");
        expect(mockCognitoSend).not.toHaveBeenCalled();
    });
});
