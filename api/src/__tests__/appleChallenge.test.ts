import { describe, it, expect, beforeEach } from "vitest";
import { MAX_ATTEMPTS, createAuthChallenge, decideChallenge, isCorrectAnswer } from "../appleChallenge";
import { resetAppleKeys } from "../appleIdToken";
import { BUNDLE, NOW, RAW_NONCE, appleKeys, appleToken } from "./helpers/appleJwt";

const APPLE_SUB = "001234.abcdef0123456789.0123";
const appleUser = { "custom:apple_sub": APPLE_SUB, sub: "uuid-1" };
const opts = { audiences: [BUNDLE], now: NOW, fetchKeys: appleKeys };
const answer = (token = appleToken(), nonce = RAW_NONCE) => JSON.stringify({ identityToken: token, nonce });

beforeEach(() => resetAppleKeys());

describe("DefineAuthChallenge", () => {
    it("Apple とつながった人には問いを出す", () => {
        expect(decideChallenge({ session: [], userAttributes: appleUser }))
            .toEqual({ challengeName: "CUSTOM_CHALLENGE", issueTokens: false, failAuthentication: false });
    });

    it("答えが合ったらトークンを出す", () => {
        expect(decideChallenge({ session: [{ challengeName: "CUSTOM_CHALLENGE", challengeResult: true }], userAttributes: appleUser }))
            .toEqual({ issueTokens: true, failAuthentication: false });
    });

    // 🔴 クライアントに ALLOW_CUSTOM_AUTH を足すと、パスワードの人にもカスタム認証を始められる。
    // ここで断らないと「パスワードを飛ばして入る」口になる
    it("Apple とつながっていない人（パスワードだけの人）は断る", () => {
        expect(decideChallenge({ session: [], userAttributes: { sub: "uuid-2" } }))
            .toEqual({ issueTokens: false, failAuthentication: true });
        expect(decideChallenge({ session: [{ challengeName: "CUSTOM_CHALLENGE", challengeResult: true }], userAttributes: { sub: "uuid-2" } }))
            .toEqual({ issueTokens: false, failAuthentication: true });
    });

    it("居ない利用者は断る", () => {
        expect(decideChallenge({ session: [], userNotFound: true, userAttributes: appleUser }).failAuthentication).toBe(true);
    });

    it("SRP など別の段が混ざった回は断る", () => {
        expect(decideChallenge({ session: [{ challengeName: "SRP_A", challengeResult: true }], userAttributes: appleUser }).failAuthentication).toBe(true);
    });

    it(`${MAX_ATTEMPTS} 回外れたら断る`, () => {
        const wrong = { challengeName: "CUSTOM_CHALLENGE", challengeResult: false };
        expect(decideChallenge({ session: [wrong], userAttributes: appleUser }).challengeName).toBe("CUSTOM_CHALLENGE");
        expect(decideChallenge({ session: Array(MAX_ATTEMPTS).fill(wrong), userAttributes: appleUser }).failAuthentication).toBe(true);
    });
});

describe("CreateAuthChallenge", () => {
    it("中身の無い問い（種類だけ）を出す", async () => {
        const ev = await createAuthChallenge({ request: { challengeName: "CUSTOM_CHALLENGE" }, response: {} });
        expect(ev.response.publicChallengeParameters).toEqual({ kind: "apple" });
        expect(ev.response.challengeMetadata).toBe("APPLE");
    });
});

describe("VerifyAuthChallengeResponse", () => {
    it("正しいトークンで、sub がその人の custom:apple_sub なら通す", async () => {
        expect(await isCorrectAnswer({ challengeAnswer: answer(), userAttributes: appleUser }, opts)).toBe(true);
    });

    // 🔴 自分の Apple ID のトークンで、他人のユーザー名に入れない
    it("別の Apple ID のトークンは通さない", async () => {
        const token = appleToken({ sub: "009999.ffff.0001" });
        expect(await isCorrectAnswer({ challengeAnswer: answer(token), userAttributes: appleUser }, opts)).toBe(false);
    });

    it("署名・nonce が合わない答えは通さない", async () => {
        expect(await isCorrectAnswer({ challengeAnswer: answer(appleToken(), "different-raw-nonce-xxxx"), userAttributes: appleUser }, opts)).toBe(false);
        expect(await isCorrectAnswer({ challengeAnswer: answer(appleToken({ aud: "com.other" })), userAttributes: appleUser }, opts)).toBe(false);
    });

    it("形の違う答え・属性の無い人は通さない（投げない）", async () => {
        expect(await isCorrectAnswer({ challengeAnswer: "not json", userAttributes: appleUser }, opts)).toBe(false);
        expect(await isCorrectAnswer({ challengeAnswer: JSON.stringify({ identityToken: 1 }), userAttributes: appleUser }, opts)).toBe(false);
        expect(await isCorrectAnswer({ challengeAnswer: answer(), userAttributes: { sub: "uuid-2" } }, opts)).toBe(false);
    });
});
