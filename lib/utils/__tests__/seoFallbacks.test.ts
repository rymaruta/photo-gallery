import { describe, it, expect } from "vitest";
import { generatePhotoStructuredData, generateOrganizationStructuredData, siteConfig } from "../seo";
import type { Photo } from "../../data/photos";

const P = (over: Partial<Photo> = {}): Photo => ({
    id: "p1", src: "https://cdn/p1.jpg", ...over,
} as Photo);

// **タイトル・説明が空の写真は実在する**（`sanitizeTitle` は空なら属性ごと
// REMOVE する）。そのとき4か所が別々のことを言っていた:
//   <title>「Untitled」（日本語のサイトに英語）／JSON-LD の name は ""／
//   パンくずは "Untitled"／meta description はサイトのキャッチコピー
// レビューが「この変更にはガードが1本も無い（戻しても全緑）」と実証したので
// ここで固定する。
describe("タイトル・説明が空の写真の構造化データ", () => {
    // 2026-10-18: 「無題」とも名乗らない。パンくず・`<title>` と同じく撮影地から組む
    it("name は空にせず、「無題」とも名乗らない（「<撮影地>の写真」/「写真」）", () => {
        const data = generatePhotoStructuredData(P({ title: undefined, location: undefined })) as Record<string, unknown>;
        expect(data.name, "空文字だと、同じページのパンくずと食い違う").toBe("写真");
        const placed = generatePhotoStructuredData(P({ title: { ja: "無題", en: "Untitled" }, location: "板橋区" })) as Record<string, unknown>;
        expect(placed.name).toBe("板橋区の写真");
        expect(placed.alternateName, "旧い既定値の英語を別名として出さない").toBeUndefined();
    });

    // 「この写真の説明はサイトの宣伝文です」と機械可読で配らない。
    // 説明を空にした写真が全部同じ description を持つことにもなる
    it("説明が無ければ description を出さない（サイトの説明を名乗らない）", () => {
        const data = generatePhotoStructuredData(P({ description: undefined })) as Record<string, unknown>;
        expect(data.description, "サイトのキャッチコピーを写真の説明として出している").toBeUndefined();
        expect(data.caption).toBeUndefined();
    });

    it("説明があればそのまま出す（正常系）", () => {
        const data = generatePhotoStructuredData(
            P({ description: { ja: ["静かな朝だった。"] } }),
        ) as Record<string, unknown>;
        expect(data.description).toContain("静かな朝");
        expect(data.caption).toContain("静かな朝");
    });
});

// `Organization.logo` も存在しないファイル（`/images/og-image.jpg`）を
// 指していた。パスは `siteConfig.ogImage` の1か所から引く
describe("Organization のロゴ", () => {
    it("siteConfig.ogImage から引く（同じパスを散らさない）", () => {
        const data = generateOrganizationStructuredData() as Record<string, unknown>;
        const logo = data.logo as { url: string };
        expect(logo.url).toBe(`${siteConfig.url}${siteConfig.ogImage}`);
    });
});
