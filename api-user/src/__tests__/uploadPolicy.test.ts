import { describe, it, expect } from "vitest";
import { extForType, uploadPrefix, isOwnUploadUrl, keyFromUploadUrl } from "../uploadPolicy";

const CDN = "https://cdn.example.com";

describe("extForType: 受け付ける形式", () => {
    it("よく使う画像形式は拡張子を返す", () => {
        expect(extForType("image/jpeg", false)).toBe("jpg");
        expect(extForType("image/png", false)).toBe("png");
        expect(extForType("image/webp", false)).toBe("webp");
        expect(extForType("image/avif", false)).toBe("avif");
        expect(extForType("image/heic", false)).toBe("heic");
    });

    it("SVG は通さない", () => {
        // SVG は <script> を書ける文書で、写真と同じ CloudFront から返る
        // （＝サイトと同一オリジン）。通すと誰でもサイト上でスクリプトを
        // 実行でき、localStorage の Cognito トークンを盗める。
        expect(extForType("image/svg+xml", false)).toBeUndefined();
        expect(extForType("image/svg+xml", true)).toBeUndefined();
    });

    it("パラメータ付き・大文字の Content-Type も正しく判定する", () => {
        expect(extForType("IMAGE/JPEG", false)).toBe("jpg");
        expect(extForType("image/jpeg; charset=utf-8", false)).toBe("jpg");
    });

    it("動画は allowVideo のときだけ通る", () => {
        expect(extForType("video/mp4", false)).toBeUndefined();
        expect(extForType("video/mp4", true)).toBe("mp4");
        expect(extForType("video/quicktime", true)).toBe("mov");
    });

    it("画像でも動画でもないものは通さない", () => {
        expect(extForType("text/html", true)).toBeUndefined();
        expect(extForType("application/pdf", true)).toBeUndefined();
        expect(extForType(undefined, true)).toBeUndefined();
        expect(extForType(123, true)).toBeUndefined();
    });
});

describe("isOwnUploadUrl: 誰のファイルか", () => {
    const mine = `${CDN}/${uploadPrefix("me")}a.jpg`;
    const theirs = `${CDN}/${uploadPrefix("you")}a.jpg`;

    it("自分の領域のURLは通る", () => {
        expect(isOwnUploadUrl(mine, CDN, "me")).toBe(true);
    });

    it("他人の領域のURLは弾く", () => {
        // ここが「他人の写真を自分のものとして登録し、削除して消す」を止める境界。
        // 以前は uploads/ 配下かどうかしか見ていなかった。
        expect(isOwnUploadUrl(theirs, CDN, "me")).toBe(false);
    });

    it("投稿者を渡さなければ uploads/ 配下かどうかしか見ない", () => {
        expect(isOwnUploadUrl(theirs, CDN)).toBe(true);
    });

    it("配信ドメイン外は弾く", () => {
        expect(isOwnUploadUrl("https://evil.example/uploads/me/a.jpg", CDN, "me")).toBe(false);
    });

    it("http は弾く", () => {
        expect(isOwnUploadUrl(mine.replace("https:", "http:"), CDN, "me")).toBe(false);
    });

    it("profiles/ など uploads 以外は弾く", () => {
        expect(isOwnUploadUrl(`${CDN}/profiles/you`, CDN, "me")).toBe(false);
    });

    it("%2F でのごまかしは通らない", () => {
        expect(isOwnUploadUrl(`${CDN}/uploads%2Fyou%2Fa.jpg`, CDN, "me")).toBe(false);
    });

    it("親ディレクトリへの遡りは弾く", () => {
        expect(isOwnUploadUrl(`${CDN}/uploads/me/../you/a.jpg`, CDN, "me")).toBe(false);
    });

    it("接頭辞だけ（実体が無い）は弾く", () => {
        expect(isOwnUploadUrl(`${CDN}/uploads/me/`, CDN, "me")).toBe(false);
    });

    it("配信ドメインが未設定なら何も通さない", () => {
        // 検証できないものは通さない（安全側に倒す）
        expect(isOwnUploadUrl(mine, "", "me")).toBe(false);
    });

    it("URL でない値は弾く", () => {
        expect(isOwnUploadUrl("uploads/me/a.jpg", CDN, "me")).toBe(false);
        expect(isOwnUploadUrl(undefined, CDN, "me")).toBe(false);
    });
});

describe("keyFromUploadUrl", () => {
    it("URL から S3 のキーを取り出す", () => {
        expect(keyFromUploadUrl(`${CDN}/uploads/me/a.jpg`)).toBe("uploads/me/a.jpg");
    });

    it("日本語などのパーセントエンコードを戻す", () => {
        expect(keyFromUploadUrl(`${CDN}/uploads/me/%E6%97%85.jpg`)).toBe("uploads/me/旅.jpg");
    });

    it("URL でなければ空文字", () => {
        expect(keyFromUploadUrl("uploads/me/a.jpg")).toBe("");
    });
});
