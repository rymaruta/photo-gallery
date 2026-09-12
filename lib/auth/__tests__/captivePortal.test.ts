import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// **本物の `amazon-cognito-identity-js` に通して確かめる。**
// 確かめたいのは「どんな err がこちらに届くか」なので、ライブラリを
// 差し替えたら意味が無い（`cognito.test.ts` はモックの側で、こちらは実物）。
//
// ホテル・空港のキャプティブポータルは **200 で HTML** を返す。中継機の
// エラーページは **503 で HTML**。どちらも「繋がってはいるが Cognito に
// 届いていない」——ここを「ログアウトした」と読むと、`useMemberGate` が
// `/login` へ replace して**編集中の文章ごと画面が入れ替わる**。
// 外出先で一番多いのはこの形（機内モードより多い）。

vi.mock("../config", () => ({
    cognitoConfig: { userPoolId: "ap-northeast-1_test", clientId: "testclientid", region: "ap-northeast-1" },
    ADMIN_GROUP_NAME: "admin", USER_GROUP_NAME: "user",
}));

const { lookupSession } = await import("../cognito");

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: object) => `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
const K = "CognitoIdentityServiceProvider.testclientid";

/** 期限切れの ID トークンと、使えるリフレッシュトークンが端末に残っている状態 */
function signedInButExpired() {
    const past = Math.floor(Date.now() / 1000) - 3600;
    localStorage.setItem(`${K}.LastAuthUser`, "u1");
    localStorage.setItem(`${K}.u1.idToken`, jwt({ sub: "u1", exp: past, "cognito:groups": ["user"] }));
    localStorage.setItem(`${K}.u1.accessToken`, jwt({ sub: "u1", exp: past }));
    localStorage.setItem(`${K}.u1.refreshToken`, "refresh-token-value");
    localStorage.setItem(`${K}.u1.clockDrift`, "0");
}

/** JSON として読めない本文（HTML が返っている） */
const htmlBody = (ok: boolean, status: number) => vi.fn(async () => ({
    ok, status, headers: new Headers(),
    json: async () => { throw new SyntaxError("Unexpected token <"); },
}));

beforeEach(() => { localStorage.clear(); signedInButExpired(); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("Cognito の応答でないものが返ってきたとき（本物のライブラリ）", () => {
    it("キャプティブポータル（200 で HTML）は「確かめられなかった」", async () => {
        vi.stubGlobal("fetch", htmlBody(true, 200));
        expect(await lookupSession()).toEqual({ session: null, unreachable: true });
    });

    // **型そのものを pin する。** 実装は `err instanceof TypeError` で
    // 見分けているので、ここで型を確かめていないと「V8 の文言との一致」に
    // 退化させる変異が素通りする（Safari では文言が違う）
    it("届く err は TypeError（文言ではなく型で見分けている）", async () => {
        vi.stubGlobal("fetch", htmlBody(true, 200));
        const { CognitoUserPool } = await import("amazon-cognito-identity-js");
        const user = new CognitoUserPool({ UserPoolId: "ap-northeast-1_test", ClientId: "testclientid" }).getCurrentUser()!;
        const err = await new Promise((resolve) => user.getSession((e: unknown) => resolve(e)));
        expect(err).toBeInstanceOf(TypeError);
    });

    // **503（HTML）と 400（失効を名乗る）はここに置かない。** 非 2xx は
    // ライブラリが5回まで撃ち直すので1本 6.5秒かかる。形は測ってあるので
    // `cognito.test.ts` 側で文言そのものを使って見る（あちらは即座に返る）:
    //   503+HTML → TypeError "Cannot read properties of undefined (reading 'split')"
    //   400+失効 → Error   code = "NotAuthorizedException"
});
