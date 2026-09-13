import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * **同じ写真が2つのホストで出ていた。** 実ビルド（2026-09-12）:
 *
 *     sitemap-images.xml  30件 = journey-photo.com 19 + d1s3….cloudfront.net 11
 *     og:image            138ページ = 69 + 69
 *
 * どちらも**同じ CloudFront ディストリビューション**（`EYRLTGCPOS9E4`）の
 * 別名で、返るバイトは同一。それでも検索エンジンには**別々の画像**に見える
 * ので、画像検索の評価が2つに割れ、半分は正規のドメインでない側に付く。
 *
 * 保存側は `738bef3` 以降サイトのURLで書くが、**それ以前の写真は残る**
 * （実データで11枚）。本番のDBは書き換えず、**出すときに揃える**。
 */
const CDN = "https://d1s3dwwzgxf5ni.cloudfront.net";
const SITE = "https://journey-photo.com";

const load = async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CLOUDFRONT_URL", CDN);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    return (await import("../seo")).publicImageUrl;
};

beforeEach(() => { vi.unstubAllEnvs(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("公開する画像URLを揃える", () => {
    it("自分の配信ドメインはサイトのドメインに揃える", async () => {
        const f = await load();
        expect(f(`${CDN}/uploads/a.jpg`), "2つのホストのまま").toBe(`${SITE}/uploads/a.jpg`);
        // クエリやパスは保つ
        expect(f(`${CDN}/uploads/a.jpg?v=2`)).toBe(`${SITE}/uploads/a.jpg?v=2`);
    });

    it("既にサイトのドメインなら触らない", async () => {
        const f = await load();
        expect(f(`${SITE}/uploads/a.jpg`)).toBe(`${SITE}/uploads/a.jpg`);
    });

    // **知らないホストは触らない。** 曲のアートワークなど、別のところから
    // 来るURLがある——揃えにいくと壊れる
    it("知らないホストは触らない", async () => {
        const f = await load();
        expect(f("https://is1-ssl.mzstatic.com/image/x.jpg")).toBe("https://is1-ssl.mzstatic.com/image/x.jpg");
        expect(f("http://example.com/a.png")).toBe("http://example.com/a.png");
    });

    it("相対パスはサイトのドメインを付ける", async () => {
        const f = await load();
        expect(f("/uploads/a.jpg")).toBe(`${SITE}/uploads/a.jpg`);
        expect(f("uploads/a.jpg"), "スラッシュが二重／欠けになっている").toBe(`${SITE}/uploads/a.jpg`);
    });

    it("空や壊れた値で落ちない", async () => {
        const f = await load();
        expect(f(undefined)).toBe("");
        expect(f("   ")).toBe("");
        expect(f("http://[bad")).toBe("http://[bad");
    });

    // **設定が無い環境で、知らないホストを書き換えない**
    // （`CDN_HOST` が空のときに「全部揃える」に倒れると、外部の画像が壊れる）
    it("配信ドメインの設定が無ければ、絶対URLは触らない", async () => {
        vi.resetModules();
        vi.stubEnv("NEXT_PUBLIC_CLOUDFRONT_URL", "");
        vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
        const f = (await import("../seo")).publicImageUrl;
        expect(f(`${CDN}/uploads/a.jpg`), "設定が無いのに書き換えている").toBe(`${CDN}/uploads/a.jpg`);
        expect(f("/uploads/a.jpg"), "相対パスは従来どおり").toBe(`${SITE}/uploads/a.jpg`);
    });
});
