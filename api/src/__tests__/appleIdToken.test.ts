import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    AppleTokenError, KEYS_REFETCH_MIN_MS, allowedAudiences, appleSignInEnabled, consumeNonce, hashNonce, resetAppleKeys, verifyAppleIdentityToken,
} from "../appleIdToken";
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
            nonceHash: hashNonce(RAW_NONCE),
            expiresAtMs: (Math.floor(NOW / 1000) + 600) * 1000,
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

    // 🔴 未認証の口なので、でたらめな kid を投げ続けられても Apple を叩き続けない
    it("知らない kid での読み直しは5分に1回まで", async () => {
        const fetchKeys = vi.fn(appleKeys);
        await verifyAppleIdentityToken(appleToken(), RAW_NONCE, { ...opts, fetchKeys });
        await verifyAppleIdentityToken(appleToken(), RAW_NONCE, { ...opts, fetchKeys });
        expect(fetchKeys).toHaveBeenCalledTimes(1);   // 控えに当たる
        for (let i = 0; i < 5; i++) {
            expect(await reason(verifyAppleIdentityToken(appleToken({}, { kid: "UNKNOWN" }), RAW_NONCE, { ...opts, fetchKeys }))).toMatch(/kid/);
        }
        expect(fetchKeys).toHaveBeenCalledTimes(1);
        const later = NOW + KEYS_REFETCH_MIN_MS + 1;
        await reason(verifyAppleIdentityToken(appleToken({ exp: Math.floor(later / 1000) + 600 }, { kid: "UNKNOWN" }), RAW_NONCE, { ...opts, now: later, fetchKeys }));
        expect(fetchKeys).toHaveBeenCalledTimes(2);
        expect(KID).toBe("TESTKID1");
    });

    it("読めなかった回・空の答えでは手元の鍵を捨てない", async () => {
        await verifyAppleIdentityToken(appleToken(), RAW_NONCE, opts);
        const later = NOW + 2 * 60 * 60 * 1000;   // 控えの1時間を過ぎた
        const tok = appleToken({ exp: Math.floor(later / 1000) + 600 });
        await expect(verifyAppleIdentityToken(tok, RAW_NONCE, { ...opts, now: later, fetchKeys: async () => { throw new Error("down"); } }))
            .resolves.toBeTruthy();
        const later2 = later + KEYS_REFETCH_MIN_MS + 1;
        const tok2 = appleToken({ exp: Math.floor(later2 / 1000) + 600 });
        await expect(verifyAppleIdentityToken(tok2, RAW_NONCE, { ...opts, now: later2, fetchKeys: async () => [] })).resolves.toBeTruthy();
    });

    it("同じ nonce は同じ口で1回まで（期限が過ぎたら忘れる）", () => {
        expect(consumeNonce("h1", "link", NOW + 1000, NOW)).toBe(true);
        expect(consumeNonce("h1", "link", NOW + 1000, NOW)).toBe(false);
        expect(consumeNonce("h1", "verify", NOW + 1000, NOW)).toBe(true);
        expect(consumeNonce("h1", "verify", NOW + 1000, NOW)).toBe(false);
        expect(consumeNonce("h1", "link", NOW + 5000, NOW + 2000)).toBe(true);
    });

    it("機能の切り替えは true のときだけ動く（既定は off）", () => {
        expect(appleSignInEnabled("")).toBe(false);
        expect(appleSignInEnabled("false")).toBe(false);
        expect(appleSignInEnabled("TRUE")).toBe(true);
    });

    it("sub の形が Apple のものでなければ断る（属性に入れる値）", async () => {
        expect(await reason(verifyAppleIdentityToken(appleToken({ sub: "a\"b" }), RAW_NONCE, opts))).toMatch(/sub/);
    });
});
