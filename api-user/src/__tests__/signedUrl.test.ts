import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import {
    signUrl, signPhotoImages, signerFromEnv, isConfigured, cannedPolicy,
    IMAGE_FIELDS, DEFAULT_TTL_SEC,
} from "../signedUrl";

/**
 * 画像 URL の期限。**作り物の鍵で、本物の署名を検証する**
 * ——「署名した気になっている」を通さないため、`createVerify` で
 * 実際に照合する。本番の鍵は使わない（持っていないし、要らない）。
 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
});
const signer = { keyPairId: "K2EXAMPLE", privateKey: privateKey as unknown as string };
const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const URL_ = "https://d1s3dwwzgxf5ni.cloudfront.net/uploads/secret.jpg";

/** CloudFront の base64 を元に戻す */
const fromCloudFrontBase64 = (s: string) =>
    Buffer.from(s.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/"), "base64");

describe("署名付き URL", () => {
    it("**本物の署名**になっている（公開鍵で照合できる）", () => {
        const out = signUrl(URL_, { now: NOW, signer });
        const q = new URL(out).searchParams;
        const expires = Number(q.get("Expires"));
        const policy = cannedPolicy(URL_, expires);
        const verify = createVerify("RSA-SHA1");
        verify.update(policy);
        expect(verify.verify(publicKey, fromCloudFrontBase64(q.get("Signature") ?? ""))).toBe(true);
    });

    it("期限は短い（既定 10分）", () => {
        const q = new URL(signUrl(URL_, { now: NOW, signer })).searchParams;
        expect(Number(q.get("Expires"))).toBe(Math.floor(NOW / 1000) + DEFAULT_TTL_SEC);
        expect(DEFAULT_TTL_SEC).toBeLessThanOrEqual(15 * 60);
    });

    it("**その URL だけ**に効く（前方一致にしない）", () => {
        const policy = JSON.parse(cannedPolicy(URL_, 1)) as
            { Statement: { Resource: string }[] };
        expect(policy.Statement[0].Resource).toBe(URL_);
        expect(policy.Statement[0].Resource).not.toContain("*");
    });

    it("Key-Pair-Id を載せる", () => {
        expect(new URL(signUrl(URL_, { now: NOW, signer })).searchParams.get("Key-Pair-Id"))
            .toBe("K2EXAMPLE");
    });

    it("既に問い合わせが付いていても壊さない", () => {
        const out = signUrl(`${URL_}?v=2`, { now: NOW, signer });
        const q = new URL(out).searchParams;
        expect(q.get("v")).toBe("2");
        expect(q.get("Signature")).toBeTruthy();
    });

    it("https 以外は触らない", () => {
        for (const u of ["/uploads/a.jpg", "data:image/png;base64,AAA", "http://x/a.jpg"]) {
            expect(signUrl(u, { now: NOW, signer })).toBe(u);
        }
    });

    // **鍵が無い環境では何もしない。** 止めると、鍵を入れるまで
    // 「フォロワーのみ」の写真が1枚も出ない
    it("鍵が無ければ、素の URL をそのまま返す", () => {
        expect(signUrl(URL_, { now: NOW, signer: undefined as never })).toBe(URL_);
        expect(signerFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
        expect(isConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    });

    it("鍵の書き間違いで一覧を落とさない（素の URL に倒れる）", () => {
        const broken = { keyPairId: "K", privateKey: "-----BEGIN RSA PRIVATE KEY-----\nnope\n-----END RSA PRIVATE KEY-----" };
        expect(signUrl(URL_, { now: NOW, signer: broken })).toBe(URL_);
    });

    it("環境変数の `\\n` を実改行として読む（Secrets から来る形）", () => {
        const env = {
            CLOUDFRONT_KEY_PAIR_ID: "K1",
            CLOUDFRONT_PRIVATE_KEY: (privateKey as unknown as string).replace(/\n/g, "\\n"),
        } as unknown as NodeJS.ProcessEnv;
        const cfg = signerFromEnv(env);
        expect(cfg).toBeDefined();
        expect(cfg?.privateKey).toContain("\n-----END");
    });
});

describe("写真の中の画像 URL", () => {
    // 🔴 `src` だけ署名すると、派生（AVIF/WebP・サムネ）が素のまま残る
    // ——鍵をかけた玄関の横に窓が開いている形
    it("派生も全部署名する", () => {
        const photo: Record<string, unknown> = {
            id: "p1", title: "題",
            src: "https://cdn/a.jpg", thumbSrc: "https://cdn/a-thumb.jpg",
            src256: "https://cdn/a-256.jpg", thumbAvif: "https://cdn/a.avif",
            thumbSm: "https://cdn/a-sm.jpg", thumbSmAvif: "https://cdn/a-sm.avif",
            srcAvif: "https://cdn/a-full.avif",
        };
        const out = signPhotoImages(photo, { now: NOW, signer });
        for (const f of IMAGE_FIELDS) {
            expect(String(out[f]), f).toContain("Signature=");
        }
    });

    it("画像でない項目は触らない", () => {
        const out = signPhotoImages(
            { id: "p1", title: "題", src: "https://cdn/a.jpg", userId: "u1" },
            { now: NOW, signer });
        expect(out.title).toBe("題");
        expect(out.userId).toBe("u1");
        expect(out.id).toBe("p1");
    });

    it("元の写真を書き換えない（写しを返す）", () => {
        const photo = { id: "p1", src: "https://cdn/a.jpg" };
        signPhotoImages(photo, { now: NOW, signer });
        expect(photo.src).toBe("https://cdn/a.jpg");
    });

    it("無い項目・空文字は足さない", () => {
        const out = signPhotoImages({ id: "p1", src: "https://cdn/a.jpg", thumbSrc: "" },
            { now: NOW, signer });
        expect(out.thumbSrc).toBe("");
        expect("src256" in out).toBe(false);
    });
});
