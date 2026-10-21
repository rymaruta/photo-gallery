import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppleTokenError, allowedAudiences, resetAppleKeys, verifyAppleIdentityToken } from "../appleIdToken";
import { BUNDLE, KID, NOW, RAW_NONCE, appleKeys, appleToken, otherKey } from "./helpers/appleJwt";

const opts = { audiences: [BUNDLE], now: NOW, fetchKeys: appleKeys };

async function reason(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (e) {
        expect(e).toBeInstanceOf(AppleTokenError);
        return (e as AppleTokenError).reason;
    }
    throw new Error("通ってしまった");
}

beforeEach(() => resetAppleKeys());

describe("Apple の ID トークンを確かめる", () => {
    it("正しいトークンは通り、使う中身だけ返す", async () => {
        const claims = await verifyAppleIdentityToken(appleToken(), RAW_NONCE, opts);
        expect(claims).toEqual({
            sub: "001234.abcdef0123456789.0123",
            email: "taro@example.com",
            emailVerified: true,
            isPrivateEmail: false,
        });
    });

    it("中継のメール（非公開）と真偽の値（boolean）も読む", async () => {
        const claims = await verifyAppleIdentityToken(
            appleToken({ email: "x1@privaterelay.appleid.com", is_private_email: true, email_verified: true }), RAW_NONCE, opts);
        expect(claims.isPrivateEmail).toBe(true);
        expect(claims.emailVerified).toBe(true);
    });

    // 🔴 署名を確かめないと、誰でも好きな sub のトークンを作れる
    it("別の鍵で署名したトークンは断る", async () => {
        expect(await reason(verifyAppleIdentityToken(appleToken({}, { key: otherKey }), RAW_NONCE, opts))).toBe("署名が合わない");
    });

    it("中身を書き換えたトークンは断る（署名はそのまま）", async () => {
        const [h, , s] = appleToken().split(".");
        const forged = Buffer.from(JSON.stringify({ iss: "https://appleid.apple.com", aud: BUNDLE, sub: "someone-else" })).toString("base64url");
        expect(await reason(verifyAppleIdentityToken(`${h}.${forged}.${s}`, RAW_NONCE, opts))).toBe("署名が合わない");
    });

    it("alg が RS256 以外（none・HS256）は署名を見る前に断る", async () => {
        expect(await reason(verifyAppleIdentityToken(appleToken({}, { alg: "none" }), RAW_NONCE, opts))).toMatch(/alg/);
        expect(await reason(verifyAppleIdentityToken(appleToken({}, { alg: "HS256" }), RAW_NONCE, opts))).toMatch(/alg/);
    });

    it("別のアプリ（aud）・別の発行元（iss）のトークンは断る", async () => {
        expect(await reason(verifyAppleIdentityToken(appleToken({ aud: "com.example.other" }), RAW_NONCE, opts))).toMatch(/aud/);
        expect(await reason(verifyAppleIdentityToken(appleToken({ iss: "https://evil.example" }), RAW_NONCE, opts))).toMatch(/iss/);
    });

    it("期限切れは断る（1分のずれは許す）", async () => {
        const exp = Math.floor(NOW / 1000) - 30;
        await expect(verifyAppleIdentityToken(appleToken({ exp }), RAW_NONCE, opts)).resolves.toBeTruthy();
        expect(await reason(verifyAppleIdentityToken(appleToken({ exp: exp - 120 }), RAW_NONCE, opts))).toBe("期限切れ");
    });

    // 🔴 nonce を見ないと、別の場面で漏れたトークンを使い回せる
    it("nonce が合わないトークンは断る", async () => {
        expect(await reason(verifyAppleIdentityToken(appleToken(), "another-raw-nonce-000000", opts))).toBe("nonce が合わない");
        expect(await reason(verifyAppleIdentityToken(appleToken({ nonce: undefined }), RAW_NONCE, opts))).toBe("nonce が合わない");
    });

    it("短すぎる nonce は受けない", async () => {
        expect(await reason(verifyAppleIdentityToken(appleToken(), "short", opts))).toMatch(/nonce/);
    });

    it("Bundle ID の設定が無ければ止める（既定値で通さない）", async () => {
        expect(await reason(verifyAppleIdentityToken(appleToken(), RAW_NONCE, { ...opts, audiences: [] }))).toMatch(/APPLE_BUNDLE_IDS/);
        expect(allowedAudiences("")).toEqual([]);
        expect(allowedAudiences(" a , b ,")).toEqual(["a", "b"]);
    });

    it("知らない kid が来たら鍵を1度だけ読み直す（Apple が鍵を回した）", async () => {
        const fetchKeys = vi.fn(appleKeys);
        await verifyAppleIdentityToken(appleToken(), RAW_NONCE, { ...opts, fetchKeys });
        await verifyAppleIdentityToken(appleToken(), RAW_NONCE, { ...opts, fetchKeys });
        expect(fetchKeys).toHaveBeenCalledTimes(1);   // 控えに当たる
        expect(await reason(verifyAppleIdentityToken(appleToken({}, { kid: "UNKNOWN" }), RAW_NONCE, { ...opts, fetchKeys }))).toMatch(/kid/);
        expect(fetchKeys).toHaveBeenCalledTimes(2);
        expect(KID).toBe("TESTKID1");
    });

    it("sub の形が Apple のものでなければ断る（属性に入れる値）", async () => {
        expect(await reason(verifyAppleIdentityToken(appleToken({ sub: "a\"b" }), RAW_NONCE, opts))).toMatch(/sub/);
    });
});
