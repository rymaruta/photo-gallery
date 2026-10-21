import { randomBytes, randomUUID } from "node:crypto";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
    AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminUpdateUserAttributesCommand,
    CognitoIdentityProviderClient, ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
    APPLE_SUB_ATTR, AppleTokenError, allowedAudiences, appleSignInEnabled, consumeNonce, verifyAppleIdentityToken, type AppleIdClaims,
} from "./appleIdToken";
import { addToUserGroup, createProfileIfMissing } from "./cognitoTrigger";

/**
 * `POST /auth/apple` — Apple でサインインの**入口**（未認証で呼べる・2026-10-21）。
 *
 *     要求  { "identityToken": "<Apple の JWT>", "nonce": "<アプリが作った生の nonce>" }
 *     応答  200 { "username": "<Cognito のユーザー名>", "created": bool, "linked": bool }
 *           400 { code: "bad_request" | "apple_email_missing" }
 *           401 { code: "apple_token_invalid" }
 *           409 { code: "apple_conflict" }   そのメールのアカウントが別の Apple ID とつながっている等
 *           503 { code: "apple_signin_off" } 設定が無い（機能を止めている）
 *
 * ここは **Cognito のトークンを出さない**。トークンを出すのは Cognito のカスタム認証
 * （`appleChallenge.ts` の3つのトリガー）で、アプリはここで受け取ったユーザー名で
 * `CUSTOM_AUTH` を始め、同じ Apple のトークンを答えとして渡す。ここの役目は
 * 「その Apple ID の利用者を探す／既存のメールのアカウントにつなぐ／新しく作る」だけ。
 *
 * ## 既存のメールのアカウントとの関係（2026-10-21 判断）
 *
 * **同じメールの確認済みアカウントがあれば、そこにつなぐ**（新しく作らない）。Apple はメールの
 * 持ち主を確かめているので、パスワードの再設定（メールに届くコード）と同じ強さ。
 * 「メールを非公開」の中継アドレスは既存のアカウントと一致しないので、別のアカウントになる。
 * 決め方は `decideAppleAccount`（純関数・テストで縛る）。
 *
 * ## 作るときの形
 *
 * ふつうの登録（iOS の `AuthGateway.signUp`）と同じく**ユーザー名は UUID・メールは属性**
 * （プールは AliasAttributes: email）。メールは確認済みで作り、`custom:apple_sub` に Apple の sub。
 * パスワードはランダムなもので確定する（`FORCE_CHANGE_PASSWORD` のまま残すと、カスタム認証の
 * あとに「新しいパスワードを決めて」が返る）。本人はあとで「パスワードを忘れた」から決められる。
 * AdminCreateUser では PostConfirmation が走らないので、`user` グループとプロフィール行は
 * ここで入れる（`cognitoTrigger.ts` と同じ関数）。
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const reply = (statusCode: number, body: unknown) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });
const fail = (statusCode: number, code: string, error: string) => reply(statusCode, { error, code });

export type PoolUser = { username: string; status?: string; attrs: Record<string, string> };

export type AppleAccountDecision =
    | { kind: "signIn"; user: PoolUser }
    | { kind: "link"; user: PoolUser }
    | { kind: "create" }
    | { kind: "conflict"; reason: string };

/**
 * そのメールの利用者の一覧から、どうするかを決める（純関数）。
 *
 * 0. 比べるのは **メールが同じ人だけ**（大文字小文字をそろえて比べる）
 * 1. この Apple ID（sub）とつながった利用者が居て、**そのメールが確認済み**なら、その人でログイン
 *    （確認済みでない人の `custom:apple_sub` は、Apple のメールの持ち主かを確かめていない）
 * 2. メールが確認済みの利用者（エイリアスはこの1人だけ）が居れば
 *    - 別の Apple ID とつながっている → 断る
 *    - 確認済み（CONFIRMED）で、Apple 側もメール確認済み → つなぐ
 *    - それ以外（パスワードの再設定待ちなど）→ 断る（作ろうとしてもエイリアスがぶつかる）
 * 3. 居ない（未確認の利用者しか居ない・誰も居ない）→ 新しく作る
 */
export function decideAppleAccount(all: PoolUser[], claims: AppleIdClaims): AppleAccountDecision {
    const users = all.filter((u) => sameEmail(u.attrs.email, claims.email));
    const mine = users.find((u) => u.attrs[APPLE_SUB_ATTR] === claims.sub && u.attrs.email_verified === "true");
    if (mine) return { kind: "signIn", user: mine };
    const verified = users.find((u) => u.attrs.email_verified === "true");
    if (!verified) return { kind: "create" };
    if (verified.attrs[APPLE_SUB_ATTR]) return { kind: "conflict", reason: "別の Apple ID とつながっている" };
    if (verified.status !== "CONFIRMED") return { kind: "conflict", reason: `つなげない状態（${verified.status ?? "不明"}）` };
    if (!claims.emailVerified) return { kind: "conflict", reason: "Apple 側のメールが未確認" };
    return { kind: "link", user: verified };
}

/** メールが同じか（前後の空白と大文字小文字をそろえて比べる） */
export function sameEmail(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return false;
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Cognito を引くときの綴りの候補（純関数）。Cognito の絞り込みは綴りどおりにしか当たらないので、
 * 登録した人が打ちがちな形を並べる: Apple の綴りそのもの・全部小文字・ドメインだけ小文字・
 * 先頭だけ大文字（ドメインは小文字）。**全部の綴りは拾えない**——拾えずに作ろうとして別名が
 * ぶつかった回は、`resolveAppleAccount` が 409（メールとパスワードで入って）に倒す（500 にしない）
 */
export function emailSpellings(email: string): string[] {
    const at = email.lastIndexOf("@");
    if (at < 1) return [email];
    const local = email.slice(0, at), domain = email.slice(at + 1).toLowerCase();
    const lowerLocal = local.toLowerCase();
    return [...new Set([
        email,
        email.toLowerCase(),
        `${local}@${domain}`,
        `${lowerLocal.charAt(0).toUpperCase()}${lowerLocal.slice(1)}@${domain}`,
    ])];
}

/** Cognito の ListUsers の絞り込みの値に入れてよいメールか（引用符・逆斜線は入れない） */
export function filterSafeEmail(email: string): boolean {
    return email.length <= 254 && !/["\\\s]/.test(email);
}

/**
 * 本人の知らないパスワード（プールの決まり: 8文字以上・大小英字・数字・記号）。
 * 確定させるためだけに使い、どこにも残さない
 */
export function randomPassword(): string {
    return `${randomBytes(24).toString("base64url")}Aa1!`;
}

// ─── Cognito の口（テストで差し替える） ──────────────────────

export type AppleSignInPool = {
    listByEmail(email: string): Promise<PoolUser[]>;
    link(username: string, sub: string): Promise<void>;
    /** 作って sub（Cognito の利用者 ID）を返す */
    create(username: string, email: string, sub: string): Promise<string>;
    setRandomPassword(username: string): Promise<void>;
    /** `user` グループとプロフィール行（失敗しても投げない） */
    welcome(username: string, userId: string): Promise<void>;
};

export function livePool(userPoolId: string, client = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION ?? "ap-northeast-1",
})): AppleSignInPool {
    const toPoolUser = (u: { Username?: string; UserStatus?: string; Attributes?: { Name?: string; Value?: string }[] }): PoolUser => ({
        username: u.Username ?? "",
        status: u.UserStatus,
        attrs: Object.fromEntries((u.Attributes ?? []).map((a) => [a.Name ?? "", a.Value ?? ""])),
    });
    return {
        // **綴りの候補を広げて引く**（`emailSpellings`。Cognito の絞り込みは綴りどおりにしか当たらない。
        // 登録の口は大文字小文字を触らずに入れている）。比べるのは `decideAppleAccount` が小文字で
        async listByEmail(email) {
            const spellings = emailSpellings(email);
            const found = new Map<string, PoolUser>();
            for (const e of spellings) {
                const res = await client.send(new ListUsersCommand({
                    UserPoolId: userPoolId, Filter: `email = "${e}"`, Limit: 10,
                }));
                for (const u of (res.Users ?? []).map(toPoolUser)) if (u.username) found.set(u.username, u);
            }
            return [...found.values()];
        },
        async link(username, sub) {
            await client.send(new AdminUpdateUserAttributesCommand({
                UserPoolId: userPoolId, Username: username,
                UserAttributes: [{ Name: APPLE_SUB_ATTR, Value: sub }],
            }));
        },
        async create(username, email, sub) {
            const res = await client.send(new AdminCreateUserCommand({
                UserPoolId: userPoolId,
                Username: username,
                // 招待のメールを送らない（本人は Apple で入る）
                MessageAction: "SUPPRESS",
                UserAttributes: [
                    { Name: "email", Value: email },
                    { Name: "email_verified", Value: "true" },
                    { Name: APPLE_SUB_ATTR, Value: sub },
                ],
            }));
            const id = (res.User?.Attributes ?? []).find((a) => a.Name === "sub")?.Value;
            if (!id) throw new Error("作った利用者の sub が返りませんでした");
            return id;
        },
        async setRandomPassword(username) {
            await client.send(new AdminSetUserPasswordCommand({
                UserPoolId: userPoolId, Username: username, Password: randomPassword(), Permanent: true,
            }));
        },
        async welcome(username, userId) {
            await addToUserGroup(client, { userPoolId, userName: username });
            await createProfileIfMissing(userId);
        },
    };
}

/**
 * 探す・つなぐ・作るの本体（handler から切り出した・テストで縛る）。
 * 同時に2本走って片方が先に作った回（AliasExists）は、**1度だけ探し直す**
 */
export async function resolveAppleAccount(
    pool: AppleSignInPool, claims: AppleIdClaims & { email: string }, newUsername: () => string = randomUUID,
): Promise<{ status: 200; username: string; created: boolean; linked: boolean } | { status: 409; reason: string }> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const decision = decideAppleAccount(await pool.listByEmail(claims.email), claims);
        switch (decision.kind) {
            case "signIn":
                // 作った直後にパスワードの確定だけ落ちた回（FORCE_CHANGE_PASSWORD）を直す
                if (decision.user.status === "FORCE_CHANGE_PASSWORD") await pool.setRandomPassword(decision.user.username);
                return { status: 200, username: decision.user.username, created: false, linked: false };
            case "link":
                await pool.link(decision.user.username, claims.sub);
                return { status: 200, username: decision.user.username, created: false, linked: true };
            case "conflict":
                return { status: 409, reason: decision.reason };
            case "create": {
                const username = newUsername();
                let userId: string;
                try {
                    userId = await pool.create(username, claims.email, claims.sub);
                } catch (e) {
                    const name = (e as { name?: string }).name;
                    if (name === "AliasExistsException" || name === "UsernameExistsException") {
                        // 1回目: 同時に作られた → 探し直す。2回目: 探しても見つからない（綴りの違いで
                        // 引けない同じメールの人が居る）→ 500 ではなく「メールで入って」の 409
                        if (attempt === 0) continue;
                        return { status: 409, reason: "同じメールの別名が既にある（綴りの違いで引けない）" };
                    }
                    throw e;
                }
                await pool.setRandomPassword(username);
                await pool.welcome(username, userId);
                return { status: 200, username, created: true, linked: false };
            }
        }
    }
    return { status: 409, reason: "同時に作られた利用者を見つけられない" };
}

let pool: AppleSignInPool | null = null;

export const appleSignIn: APIGatewayProxyHandlerV2 = async (event) => {
    const userPoolId = process.env.COGNITO_USER_POOL_ID ?? "";
    if (!appleSignInEnabled() || !userPoolId || allowedAudiences().length === 0) {
        console.warn("appleSignIn: 止めています（APPLE_SIGNIN_ENABLED が true でない・COGNITO_USER_POOL_ID か APPLE_BUNDLE_IDS が未設定）");
        return fail(503, "apple_signin_off", "Apple でサインインは準備中です");
    }
    let body: { identityToken?: unknown; nonce?: unknown };
    try {
        const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
        body = JSON.parse(raw) as typeof body;
    } catch {
        return fail(400, "bad_request", "要求の形が違います");
    }
    if (typeof body?.identityToken !== "string" || typeof body?.nonce !== "string") {
        return fail(400, "bad_request", "identityToken と nonce が要ります");
    }
    let claims: AppleIdClaims;
    try {
        claims = await verifyAppleIdentityToken(body.identityToken, body.nonce);
    } catch (e) {
        if (e instanceof AppleTokenError) {
            console.warn(`appleSignIn: ${e.reason}`);
            return fail(401, "apple_token_invalid", "Apple の確認が通りませんでした。もう一度お試しください");
        }
        console.error("appleSignIn: Apple の公開鍵を読めませんでした:", e);
        return fail(503, "apple_unreachable", "Apple に繋がりませんでした。しばらくしてからお試しください");
    }
    // 同じトークンでこの口を2回通さない（`consumeNonce` の注記: 実体の中だけ）
    if (!consumeNonce(claims.nonceHash, "link", claims.expiresAtMs)) {
        console.warn("appleSignIn: 同じ nonce の2回目");
        return fail(401, "apple_token_invalid", "Apple の確認が通りませんでした。もう一度お試しください");
    }
    if (!claims.email || !filterSafeEmail(claims.email)) {
        return fail(400, "apple_email_missing", "Apple からメールアドレスを受け取れませんでした");
    }
    try {
        pool ??= livePool(userPoolId);
        const result = await resolveAppleAccount(pool, { ...claims, email: claims.email });
        if (result.status === 409) {
            console.warn(`appleSignIn: つなげませんでした（${result.reason}）`);
            return fail(409, "apple_conflict",
                "このメールアドレスのアカウントには、Apple でサインインをつなげません。メールアドレスとパスワードでログインしてください");
        }
        // 利用者 ID もメールも出さない（ログに残すのは種類だけ）
        console.log(`appleSignIn: ok created=${result.created} linked=${result.linked}`);
        return reply(200, { username: result.username, created: result.created, linked: result.linked });
    } catch (e) {
        console.error("appleSignIn: Cognito の操作で落ちました:", e);
        return fail(500, "apple_signin_failed", "うまくいきませんでした。しばらくしてからお試しください");
    }
};
