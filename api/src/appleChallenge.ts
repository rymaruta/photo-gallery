import { APPLE_SUB_ATTR, appleSignInEnabled, consumeNonce, verifyAppleIdentityToken } from "./appleIdToken";

/**
 * Apple でサインインのための **Cognito のカスタム認証のトリガー3本**（2026-10-21）。
 *
 * アプリは `/auth/apple` で受け取ったユーザー名で `CUSTOM_AUTH`（SRP なし）を始め、
 * Apple の ID トークンと nonce を答えとして渡す。ここで同じ確かめ（`verifyAppleIdentityToken`）を
 * して、**トークンの sub がその利用者の `custom:apple_sub` と同じ**ときだけ通す。
 *
 * 🔴 **`custom:apple_sub` を持たない利用者はこの道で入れない**（Verify が通さない）。プールのクライアントに
 * `ALLOW_CUSTOM_AUTH` を足すと、パスワードの利用者にもカスタム認証を始められるようになるので、
 * ここが「パスワードを飛ばして入る」口にならないことをテストで縛る（`appleChallenge.test.ts`）。
 *
 * **2026-10-21 判断: Define は誰にでも同じ形の問いを出す**（居ない人・Apple とつながっていない人にも）。
 * 最初の一手で断ると、「そのユーザー名（メールの別名）が Apple とつながっているか」を外から見分けられた。
 * 断るのは Verify で、外れが `MAX_ATTEMPTS` 回たまったら Define が締める。
 * 機能を止めている間（`APPLE_SIGNIN_ENABLED` が true でない）も、同じく Verify が通さない。
 *
 * どのトリガーも**投げない**（投げると Cognito は利用者に英文の失敗を返す。断るのは
 * `failAuthentication` / `answerCorrect: false` で）。
 */

/** 答えを試せる回数（打ち間違いではなく通信の失敗のやり直しのため） */
export const MAX_ATTEMPTS = 3;

type ChallengeResult = { challengeName?: string; challengeResult?: boolean };

export type DefineEvent = {
    request: { session?: ChallengeResult[]; userAttributes?: Record<string, string>; userNotFound?: boolean };
    response: { challengeName?: string; issueTokens?: boolean; failAuthentication?: boolean };
};

/** 次の一手を決める（純関数） */
export function decideChallenge(request: DefineEvent["request"]): DefineEvent["response"] {
    const fail = { issueTokens: false, failAuthentication: true };
    const session = request.session ?? [];
    // **自分の出した問いだけを数える。** SRP など別の段が混ざった回は断る（SRP なしで始める決まり）
    if (session.some((s) => s.challengeName !== "CUSTOM_CHALLENGE")) return fail;
    const last = session[session.length - 1];
    // 通った回でも、居ない人・つながっていない人にはトークンを出さない（Verify が通さないはずだが、二重に見る）
    if (last?.challengeResult === true) {
        if (request.userNotFound || !request.userAttributes?.[APPLE_SUB_ATTR]) return fail;
        return { issueTokens: true, failAuthentication: false };
    }
    if (session.length >= MAX_ATTEMPTS) return fail;
    return { challengeName: "CUSTOM_CHALLENGE", issueTokens: false, failAuthentication: false };
}

export const defineAuthChallenge = async (event: DefineEvent): Promise<DefineEvent> => {
    event.response = { ...event.response, ...decideChallenge(event.request ?? {}) };
    return event;
};

export type CreateEvent = {
    request: { challengeName?: string };
    response: {
        publicChallengeParameters?: Record<string, string>;
        privateChallengeParameters?: Record<string, string>;
        challengeMetadata?: string;
    };
};

/** 問いの中身は無い（答えは Apple のトークンそのもの）。種類だけ渡す */
export const createAuthChallenge = async (event: CreateEvent): Promise<CreateEvent> => {
    event.response = {
        ...event.response,
        publicChallengeParameters: { kind: "apple" },
        privateChallengeParameters: { kind: "apple" },
        challengeMetadata: "APPLE",
    };
    return event;
};

export type VerifyEvent = {
    request: { challengeAnswer?: string; userAttributes?: Record<string, string> };
    response: { answerCorrect?: boolean };
};

/** 答えが合っているか（純関数に近い形・鍵の読み込みだけ外から渡せる） */
export async function isCorrectAnswer(
    request: VerifyEvent["request"],
    opts: Parameters<typeof verifyAppleIdentityToken>[2] & { enabled?: string } = {},
): Promise<boolean> {
    if (!appleSignInEnabled(opts.enabled)) return false;
    const expected = request.userAttributes?.[APPLE_SUB_ATTR];
    if (!expected) return false;
    let answer: { identityToken?: unknown; nonce?: unknown };
    try {
        answer = JSON.parse(request.challengeAnswer ?? "") as typeof answer;
    } catch {
        return false;
    }
    if (typeof answer?.identityToken !== "string" || typeof answer?.nonce !== "string") return false;
    try {
        const claims = await verifyAppleIdentityToken(answer.identityToken, answer.nonce, opts);
        if (claims.sub !== expected) return false;
        // 同じトークンで2回通さない（`consumeNonce` の注記: 実体の中だけ）
        return consumeNonce(claims.nonceHash, "verify", claims.expiresAtMs, opts.now);
    } catch (e) {
        console.warn("verifyAuthChallengeResponse:", (e as Error).message);
        return false;
    }
}

export const verifyAuthChallengeResponse = async (event: VerifyEvent): Promise<VerifyEvent> => {
    event.response = { ...event.response, answerCorrect: await isCorrectAnswer(event.request ?? {}) };
    return event;
};
