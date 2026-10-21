import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";

/**
 * Apple でサインインの **ID トークン（identityToken・JWT）を確かめる**（2026-10-21）。
 *
 * アプリが `ASAuthorizationAppleIDProvider` で受け取ったトークンを、Apple の公開鍵で確かめる。
 * **秘密は要らない**（公開鍵は https://appleid.apple.com/auth/keys で誰でも読める）。
 *
 * 確かめること（Apple の「Verifying a user」の手順どおり）:
 *   - 署名: RS256・`kid` の公開鍵
 *   - `iss` が https://appleid.apple.com
 *   - `aud` がこのアプリの Bundle ID（`APPLE_BUNDLE_IDS`・カンマ区切りで本番と staging を並べられる）
 *   - `exp` が過ぎていない（少しの時計のずれは許す）
 *   - `nonce` が、アプリが渡した生の nonce の SHA-256（16進）。**別のアプリ・前の回のトークンの使い回しを止める**
 *
 * 使うのは `/auth/apple`（利用者を探す・作る）と、Cognito の VerifyAuthChallengeResponse
 * （ログインを通す）の2か所。**同じ関数で確かめる**——片方だけ緩むと、緩い方から入れる。
 */

export const APPLE_ISSUER = "https://appleid.apple.com";
/**
 * Apple の sub を置く Cognito の独自属性。**プールに足すのは owner**（`scripts/setup-apple-signin.js`）。
 * アプリ（iOS）は ID トークンのこの値で「Apple の人か」を見分ける（退会のときの取り消し）
 */
export const APPLE_SUB_ATTR = "custom:apple_sub";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
/** 時計のずれの許し（秒） */
const CLOCK_SKEW_SEC = 60;

export type AppleIdClaims = {
    sub: string;
    /** nonce の SHA-256（使い回しの見張りの鍵）と、トークンの期限（epoch ミリ秒） */
    nonceHash: string;
    expiresAtMs: number;
    email?: string;
    emailVerified: boolean;
    isPrivateEmail: boolean;
};

export class AppleTokenError extends Error {
    constructor(public readonly reason: string) {
        super(`Apple の ID トークンを確かめられません: ${reason}`);
        this.name = "AppleTokenError";
    }
}

type Jwk = JsonWebKey & { kid?: string; alg?: string };

/**
 * 機能の切り替え（`APPLE_SIGNIN_ENABLED`・**既定は off**・2026-10-21）。`"true"` のときだけ動く。
 * off の間は入口が 503 を返し、Verify も通さない（Bundle ID の設定とは別に、止めた状態を明示で持つ）
 */
export function appleSignInEnabled(raw = process.env.APPLE_SIGNIN_ENABLED ?? ""): boolean {
    return raw.trim().toLowerCase() === "true";
}

/** 許す Bundle ID（`APPLE_BUNDLE_IDS`）。空なら機能を止める（既定値は置かない） */
export function allowedAudiences(raw = process.env.APPLE_BUNDLE_IDS ?? ""): string[] {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** アプリが Apple に渡す nonce（生の nonce の SHA-256・16進の小文字） */
export function hashNonce(rawNonce: string): string {
    return createHash("sha256").update(rawNonce, "utf8").digest("hex");
}

function b64urlDecode(part: string): Buffer {
    return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function parseJson(part: string): Record<string, unknown> {
    try {
        const v = JSON.parse(b64urlDecode(part).toString("utf8")) as unknown;
        if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* 下で投げる */ }
    throw new AppleTokenError("形が JWT ではない");
}

/** Apple は真偽を文字列（"true"）で返すことがある */
function truthy(v: unknown): boolean {
    return v === true || v === "true";
}

function sameString(a: string, b: string): boolean {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}

// ─── 公開鍵 ─────────────────────────────────────────────

const KEYS_TTL_MS = 60 * 60 * 1000;
/** Apple へ鍵を読みにいく間合いの下限（知らない `kid` を投げ続けられても、Apple を叩き続けない） */
export const KEYS_REFETCH_MIN_MS = 5 * 60 * 1000;
let cachedKeys: { keys: Jwk[]; at: number } | null = null;
let lastFetchAt = Number.NEGATIVE_INFINITY;

/** 控えを捨てる（テストから） */
export function resetAppleKeys(): void {
    cachedKeys = null;
    lastFetchAt = Number.NEGATIVE_INFINITY;
    seenNonces.clear();
}

export type KeyFetcher = () => Promise<Jwk[]>;

export const fetchAppleKeys: KeyFetcher = async () => {
    const res = await fetch(APPLE_KEYS_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`Apple の公開鍵を読めません（${res.status}）`);
    const body = (await res.json()) as { keys?: Jwk[] };
    return Array.isArray(body.keys) ? body.keys : [];
};

/**
 * `kid` の公開鍵。1時間控える。控えに無い `kid` が来たら読み直す（Apple が鍵を回した）。
 *
 * - **読み直しは `KEYS_REFETCH_MIN_MS`（5分）に1回まで。** 未認証の口なので、でたらめな `kid` を
 *   投げ続けられると、そのたびに Apple を叩いていた。⚠️ その代わり、**Apple が鍵を新しくした直後は、
 *   新しい鍵のトークンを最長5分断ることがある**（その5分の間に別の読み直しが済んでいた回）。
 *   利用者には「もう一度お試しください」が出る
 * - **読めなかった回・空の答えでは控えを上書きしない**（Apple の一時的な不調で、手元の正しい鍵まで
 *   捨てない）。古くなった控えでも、合う鍵があれば使う
 */
async function keyFor(kid: string, fetchKeys: KeyFetcher, now: number): Promise<Jwk | undefined> {
    const fresh = cachedKeys !== null && now - cachedKeys.at < KEYS_TTL_MS;
    const hit = cachedKeys?.keys.find((k) => k.kid === kid);
    if (hit && fresh) return hit;
    if (now - lastFetchAt < KEYS_REFETCH_MIN_MS) return hit;
    lastFetchAt = now;
    let keys: Jwk[];
    try {
        keys = await fetchKeys();
    } catch (e) {
        if (hit) return hit;
        throw e;
    }
    if (keys.length > 0) cachedKeys = { keys, at: now };
    return cachedKeys?.keys.find((k) => k.kid === kid);
}

// ─── 使い回しの見張り ─────────────────────────────────────

/**
 * nonce の使い回しを止める（**Lambda の1つの実体の中だけ**・2026-10-21 判断）。
 *
 * 同じ nonce（＝同じ Apple のトークン）は、入口（`/auth/apple`）で1回・Verify で1回まで。
 * 覚えるのはトークンの期限まで。
 *
 * ⚠️ **実体をまたいだ見張りではない。** 別の実体に回された2回目は通る。既存の DynamoDB の表に
 * 置くことも考えたが、**どの表も TTL が有効になっていない**（users の墓石の `ttl` も未有効・
 * `api-user/src/account.ts`）。写真テーブル・users テーブルは全表 Scan で読む口があり、消えない行を
 * ログインのたびに足すと全員の表示が遅くなる。新しい表・TTL の有効化は owner の承認が要るので見送った。
 * 残る使い回しの道は「通信の途中でトークンと nonce を盗む」ことで、TLS とトークンの短い期限（Apple は
 * 約10分）で狭まっている
 */
const seenNonces = new Map<string, number>();

/**
 * @returns 初めてなら true（覚える）。期限内に同じ `purpose` で見ていれば false
 */
export function consumeNonce(nonceHash: string, purpose: "link" | "verify", expiresAtMs: number, now = Date.now()): boolean {
    for (const [k, exp] of seenNonces) if (exp < now) seenNonces.delete(k);
    const key = `${purpose}:${nonceHash}`;
    if (seenNonces.has(key)) return false;
    // 溢れさせない（1つの実体が覚えるのは最近の分だけ）
    if (seenNonces.size >= 5000) seenNonces.delete(seenNonces.keys().next().value as string);
    seenNonces.set(key, expiresAtMs);
    return true;
}

// ─── 確かめる ───────────────────────────────────────────

/**
 * 確かめて、使う中身だけ返す。**どれか1つでも合わなければ `AppleTokenError` を投げる。**
 *
 * @param rawNonce アプリが作った生の nonce（Apple には SHA-256 を渡している）
 */
export async function verifyAppleIdentityToken(
    token: string,
    rawNonce: string,
    opts: { audiences?: string[]; now?: number; fetchKeys?: KeyFetcher } = {},
): Promise<AppleIdClaims> {
    const audiences = opts.audiences ?? allowedAudiences();
    const now = opts.now ?? Date.now();
    if (audiences.length === 0) throw new AppleTokenError("APPLE_BUNDLE_IDS が未設定");
    if (typeof token !== "string" || token.length > 8192) throw new AppleTokenError("トークンが無い・長すぎる");
    if (typeof rawNonce !== "string" || rawNonce.length < 16 || rawNonce.length > 256) {
        throw new AppleTokenError("nonce が無い・短すぎる");
    }
    const parts = token.split(".");
    if (parts.length !== 3) throw new AppleTokenError("形が JWT ではない");
    const header = parseJson(parts[0]);
    const payload = parseJson(parts[1]);
    // **alg は RS256 だけ。** `none` や HS256 を受けると、署名の確かめを飛ばせてしまう
    if (header.alg !== "RS256") throw new AppleTokenError(`alg が RS256 ではない（${String(header.alg)}）`);
    const kid = typeof header.kid === "string" ? header.kid : "";
    if (!kid) throw new AppleTokenError("kid が無い");

    const jwk = await keyFor(kid, opts.fetchKeys ?? fetchAppleKeys, now);
    if (!jwk) throw new AppleTokenError(`kid ${kid} の公開鍵が無い`);
    let ok = false;
    try {
        const key = createPublicKey({ key: jwk, format: "jwk" });
        ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, b64urlDecode(parts[2]));
    } catch {
        ok = false;
    }
    if (!ok) throw new AppleTokenError("署名が合わない");

    if (payload.iss !== APPLE_ISSUER) throw new AppleTokenError("iss が Apple ではない");
    const aud = payload.aud;
    const auds = Array.isArray(aud) ? aud.map(String) : [String(aud ?? "")];
    if (!auds.some((a) => audiences.includes(a))) throw new AppleTokenError("aud がこのアプリではない");
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp) || exp * 1000 + CLOCK_SKEW_SEC * 1000 < now) throw new AppleTokenError("期限切れ");
    const iat = Number(payload.iat);
    if (Number.isFinite(iat) && iat * 1000 - CLOCK_SKEW_SEC * 1000 > now) throw new AppleTokenError("発行が未来");
    const nonce = typeof payload.nonce === "string" ? payload.nonce : "";
    if (!nonce || !sameString(nonce, hashNonce(rawNonce))) throw new AppleTokenError("nonce が合わない");
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    // Apple の sub は「000123.abcdef….0123」の形（英数と点）。Cognito の属性に入れるので形も見る
    if (!/^[A-Za-z0-9.]{1,128}$/.test(sub)) throw new AppleTokenError("sub の形が違う");

    // ここでは大文字小文字を触らない（探すときに、元の綴りと小文字の両方で引いて、小文字で比べる・
    // `appleSignIn.ts` の `sameEmail`）
    const email = typeof payload.email === "string" && payload.email.includes("@")
        ? payload.email.trim() : undefined;
    return {
        sub,
        nonceHash: nonce,
        expiresAtMs: exp * 1000,
        email,
        emailVerified: truthy(payload.email_verified),
        isPrivateEmail: truthy(payload.is_private_email),
    };
}
