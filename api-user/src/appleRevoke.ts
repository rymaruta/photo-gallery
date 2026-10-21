import { createPrivateKey, sign } from "node:crypto";
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { jsonError } from "./http";

/**
 * `POST /user/apple/revoke` — 退会のときに **Apple でサインインの許可を取り消す**（2026-10-21）。
 *
 * 審査の決まり 5.1.1(v): Apple でサインインを使うアプリは、退会のときに Apple の REST API で
 * トークンを取り消す。アプリは退会の直前に Apple のシートをもう一度出して**新しい認可コード**を取り、
 * ここへ送る。ここで .p8 の鍵で client_secret（ES256 の JWT）を作り、
 *
 *   1. https://appleid.apple.com/auth/token   認可コード → 更新トークン（と ID トークン）
 *   2. https://appleid.apple.com/auth/revoke  更新トークンを取り消す
 *
 * の順に呼ぶ。1. で Apple から返った ID トークンの sub が、呼んだ人の Cognito の ID トークンの
 * `custom:apple_sub` と違えば 403（交換で生まれた更新トークンは取り消してから断る）。
 *
 *     要求  { "authorizationCode": "<ASAuthorizationAppleIDCredential.authorizationCode>" }
 *     応答  204（取り消した）
 *           400 bad_request / 403 not_apple_user・apple_sub_mismatch / 502 apple_failed / 503 apple_signin_off
 *
 * ## 鍵は SSM パラメータストア（WeatherKit と同じ置き方・owner が AWS の画面で作る）
 *
 *     /journey-photo/<stage>/apple-signin/key-id       String       キー ID
 *     /journey-photo/<stage>/apple-signin/private-key  SecureString .p8 の中身をそのまま
 *
 * 環境変数（`serverless.yml` から**この関数にだけ**配る）:
 *   APPLE_SIGNIN_PARAM_PREFIX  `/journey-photo/<stage>/apple-signin`
 *   APPLE_TEAM_ID              チーム ID（JWT の iss・秘密ではない）
 *   APPLE_CLIENT_ID            Bundle ID（JWT の sub と client_id・秘密ではない）
 *
 * **どれかが無ければ 503**（既定値は置かない）。アプリは取り消しが落ちても退会を止めない
 * （iOS の `AppleSignIn.revokeBeforeDeletion` の 2026-10-21 判断）。
 *
 * 鍵の読み方は `weatherKit.ts` と同じ形だが、**名前と道を混ぜない**ために別に持つ（2026-10-21 判断:
 * WeatherKit の鍵を読めるロールに Apple の鍵まで読ませない・逆も同じ）。
 */

const PARAM_PREFIX = (process.env.APPLE_SIGNIN_PARAM_PREFIX ?? "").replace(/\/+$/, "");
const TEAM_ID = process.env.APPLE_TEAM_ID ?? "";
const CLIENT_ID = process.env.APPLE_CLIENT_ID ?? "";
const APPLE = "https://appleid.apple.com";

export type AppleSignInKey = { keyId: string; privateKey: string };

/** パラメータの値から鍵を作る（純関数）。空・鍵として読めないなら null */
export function toAppleSignInKey(keyIdRaw: unknown, privateKeyRaw: unknown): AppleSignInKey | null {
    const keyId = typeof keyIdRaw === "string" ? keyIdRaw.trim() : "";
    const privateKey = typeof privateKeyRaw === "string" ? privateKeyRaw.replace(/\\n/g, "\n").trim() : "";
    if (!keyId || !privateKey) return null;
    try {
        createPrivateKey(privateKey);
    } catch {
        console.warn("appleRevoke: private-key を鍵として読めません（.p8 の中身をそのまま入れてください）");
        return null;
    }
    return { keyId, privateKey };
}

const KEY_TTL_MS = 5 * 60 * 1000;
let cachedKey: { value: AppleSignInKey | null; at: number } | null = null;
let ssm: SSMClient | null = null;

export function resetAppleSignInKey(): void {
    cachedKey = null;
}

async function appleSignInKey(now = Date.now()): Promise<AppleSignInKey | null> {
    if (!PARAM_PREFIX || !TEAM_ID || !CLIENT_ID) return null;
    if (cachedKey && now - cachedKey.at < KEY_TTL_MS) return cachedKey.value;
    let value: AppleSignInKey | null = null;
    try {
        ssm ??= new SSMClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
        const idName = `${PARAM_PREFIX}/key-id`, keyName = `${PARAM_PREFIX}/private-key`;
        const res = await ssm.send(new GetParametersCommand({ Names: [idName, keyName], WithDecryption: true }));
        const byName = new Map((res.Parameters ?? []).map((p) => [p.Name, p.Value]));
        value = toAppleSignInKey(byName.get(idName), byName.get(keyName));
    } catch (e) {
        console.warn("appleRevoke: パラメータを読めませんでした:", e);
        // 読めなかった回は控えない（次の退会で読み直す）
        return null;
    }
    cachedKey = { value, at: now };
    return value;
}

function base64url(input: Buffer | string): string {
    return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Apple に出す client_secret（ES256 の JWT）。
 *
 *   header  { alg: "ES256", kid: キーID }
 *   payload { iss: チームID, iat, exp（5分）, aud: "https://appleid.apple.com", sub: Bundle ID }
 *
 * **署名は R||S の生の形**（`ieee-p1363`）。既定の DER では Apple が invalid_client を返す
 * （`weatherKit.ts`・`apns.ts` と同じ落とし穴）
 */
export function appleClientSecret(key: AppleSignInKey, teamId: string, clientId: string, now = Date.now()): string {
    const iat = Math.floor(now / 1000);
    const header = base64url(JSON.stringify({ alg: "ES256", kid: key.keyId }));
    const payload = base64url(JSON.stringify({ iss: teamId, iat, exp: iat + 300, aud: APPLE, sub: clientId }));
    const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
        key: createPrivateKey(key.privateKey),
        dsaEncoding: "ieee-p1363",
    });
    return `${header}.${payload}.${base64url(signature)}`;
}

/** Apple から直接（TLS で）受け取った ID トークンの sub。署名は見ない（相手は Apple そのもの） */
export function subOfIdToken(idToken: unknown): string | null {
    if (typeof idToken !== "string") return null;
    const part = idToken.split(".")[1];
    if (!part) return null;
    try {
        const payload = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { sub?: unknown };
        return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
    } catch {
        return null;
    }
}

export type AppleFetch = (url: string, form: Record<string, string>) => Promise<{ status: number; body: unknown }>;

const liveFetch: AppleFetch = async (url, form) => {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* 取り消しの成功は空の本文 */ }
    return { status: res.status, body };
};

/**
 * 交換して取り消す本体（テストで縛る）。
 * @returns "revoked" | "mismatch"（本人の Apple ID ではない）| "failed"（Apple が断った・繋がらない）
 */
export async function revokeWithCode(
    code: string, expectedSub: string,
    cfg: { clientId: string; clientSecret: string }, post: AppleFetch = liveFetch,
): Promise<"revoked" | "mismatch" | "failed"> {
    const token = await post(`${APPLE}/auth/token`, {
        client_id: cfg.clientId, client_secret: cfg.clientSecret, code, grant_type: "authorization_code",
    });
    const body = (token.body ?? {}) as { refresh_token?: unknown; id_token?: unknown; error?: unknown };
    if (token.status !== 200 || typeof body.refresh_token !== "string") {
        console.warn(`appleRevoke: コードを交換できませんでした（${token.status} ${String(body.error ?? "")}）`);
        return "failed";
    }
    // **2026-10-21 判断: sub が違っても、交換で受け取った更新トークンは取り消してから断る。**
    // 交換した時点で新しい更新トークンが生まれている——放っておくと、使われない鍵が Apple に残る。
    // **残る鍵を消すことを優先した。** その代わり、家族で共有している端末などで、退会する人とは別の
    // Apple ID でシートに答えた回は、**その別の人の「Apple でサインイン」の許可を取り消すことがありうる**
    // （その人は次に Apple で入るとき、もう一度許可を求められるだけで、アカウントは消えない）
    const mismatch = subOfIdToken(body.id_token) !== expectedSub;
    const revoke = await post(`${APPLE}/auth/revoke`, {
        client_id: cfg.clientId, client_secret: cfg.clientSecret,
        token: body.refresh_token, token_type_hint: "refresh_token",
    });
    if (mismatch) return "mismatch";
    if (revoke.status !== 200) {
        console.warn(`appleRevoke: 取り消しを断られました（${revoke.status}）`);
        return "failed";
    }
    return "revoked";
}

export const revokeAppleSignIn: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const appleSub = String(event.requestContext.authorizer.jwt.claims["custom:apple_sub"] ?? "");
    if (!appleSub) return jsonError(403, "Apple でサインインのアカウントではありません", "not_apple_user");
    let code = "";
    try {
        const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
        const parsed = JSON.parse(raw) as { authorizationCode?: unknown };
        code = typeof parsed?.authorizationCode === "string" ? parsed.authorizationCode : "";
    } catch { /* 下で断る */ }
    if (!code || code.length > 2048) return jsonError(400, "authorizationCode が要ります", "bad_request");
    const key = await appleSignInKey();
    if (!key) return jsonError(503, "Apple でサインインの設定がありません", "apple_signin_off");
    try {
        const result = await revokeWithCode(code, appleSub, {
            clientId: CLIENT_ID, clientSecret: appleClientSecret(key, TEAM_ID, CLIENT_ID),
        });
        if (result === "mismatch") return jsonError(403, "この Apple ID のアカウントではありません", "apple_sub_mismatch");
        if (result === "failed") return jsonError(502, "Apple で取り消せませんでした", "apple_failed");
        return { statusCode: 204, body: "" };
    } catch (e) {
        console.error("appleRevoke: Apple に繋がりませんでした:", e);
        return jsonError(502, "Apple に繋がりませんでした", "apple_failed");
    }
};
