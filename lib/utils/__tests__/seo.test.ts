import { describe, it, expect } from "vitest";
import {
    siteConfig,
    generateStructuredData,
    generatePhotoStructuredData,
    generateBreadcrumbStructuredData,
    generateOrganizationStructuredData,
    generateWebSiteStructuredData,
} from "../seo";

describe("siteConfig", () => {
    it("必須フィールドが揃っている", () => {
        expect(siteConfig.name).toBeTruthy();
        expect(siteConfig.description).toBeTruthy();
        expect(siteConfig.url).toBeTruthy();
    });
});

describe("generateStructuredData", () => {
    it("ImageGallery スキーマを生成する", () => {
        const data = generateStructuredData([
            { id: "1", src: "https://cdn.example.com/1.jpg", title: { ja: "タイトル", en: "Title" } },
        ]);
        expect(data["@type"]).toBe("ImageGallery");
        expect((data.image as unknown[]).length).toBe(1);
    });

    it("id や src が空のエントリは除外する", () => {
        const data = generateStructuredData([
            { id: "", src: "x.jpg" },
            { id: "2", src: "" },
            { id: "3", src: "https://cdn.example.com/3.jpg" },
        ]);
        expect((data.image as unknown[]).length).toBe(1);
    });

    it("相対 src には siteConfig.url を付与する", () => {
        const data = generateStructuredData([{ id: "1", src: "/img/1.jpg" }]);
        const img = (data.image as Array<{ contentUrl: string }>)[0];
        expect(img.contentUrl).toContain(siteConfig.url);
        expect(img.contentUrl).toContain("/img/1.jpg");
    });
});

describe("generatePhotoStructuredData", () => {
    const base = { id: "abc", src: "https://cdn.example.com/abc.jpg" };

    it("ImageObject スキーマを生成する", () => {
        const data = generatePhotoStructuredData(base);
        expect(data["@type"]).toBe("ImageObject");
        expect(data["@id"]).toContain("abc");
    });

    it("photographer がある場合 creator を含む", () => {
        const data = generatePhotoStructuredData({ ...base, photographer: "山田太郎" });
        expect((data.creator as { name: string }).name).toBe("山田太郎");
    });

    it("location + coords がある場合 contentLocation に geo を含む", () => {
        const data = generatePhotoStructuredData({
            ...base,
            location: "東京",
            coords: { lat: 35.68, lng: 139.69 },
        });
        const loc = data.contentLocation as { "@type": string; geo: { latitude: number } };
        expect(loc["@type"]).toBe("Place");
        expect(loc.geo.latitude).toBe(35.68);
    });

    it("title が LocalizedText の場合 locale に応じたテキストを使う", () => {
        const data = generatePhotoStructuredData(
            { ...base, title: { ja: "日本語タイトル", en: "English Title" } },
            "en"
        );
        expect(data.name).toBe("English Title");
    });

    it("もう一方の言語タイトルを alternateName に入れる（日英露出）", () => {
        const data = generatePhotoStructuredData(
            { ...base, title: { ja: "白鳥", en: "Swan" } },
            "ja"
        );
        expect(data.name).toBe("白鳥");
        expect(data.alternateName).toBe("Swan");
    });

    it("説明は日英併記になり caption にも入る", () => {
        const data = generatePhotoStructuredData({
            ...base,
            description: { ja: ["湖の白鳥"], en: ["Swans on the lake"] },
        });
        expect(String(data.description)).toContain("湖の白鳥");
        expect(String(data.description)).toContain("Swans on the lake");
        expect(data.caption).toBe(data.description);
    });

    it("thumbnailUrl / keywords / datePublished / representativeOfPage を含む", () => {
        const data = generatePhotoStructuredData({
            ...base,
            thumbSrc: "https://cdn.example.com/abc_thumb.webp",
            tags: ["白鳥", "swan"],
            createdAt: "2026-05-01T00:00:00.000Z",
        });
        expect(data.thumbnailUrl).toBe("https://cdn.example.com/abc_thumb.webp");
        expect(data.keywords).toBe("白鳥, swan");
        expect(data.datePublished).toBe("2026-05-01T00:00:00.000Z");
        expect(data.representativeOfPage).toBe(true);
    });

    it("license は URL のみ有効。自由文は copyrightNotice に回す", () => {
        const url = generatePhotoStructuredData({ ...base, license: "https://creativecommons.org/licenses/by/4.0/" });
        expect(url.license).toBe("https://creativecommons.org/licenses/by/4.0/");
        expect(url.acquireLicensePage).toContain("/photo/abc");
        const text = generatePhotoStructuredData({ ...base, license: "All rights reserved" });
        expect(text.license).toBeUndefined();
        expect(text.copyrightNotice).toBe("All rights reserved");
    });

    it("photographer/displayName は creditText に入る", () => {
        const data = generatePhotoStructuredData({ ...base, displayName: "丸田" });
        expect(data.creditText).toBe("丸田");
    });
});

describe("generateBreadcrumbStructuredData", () => {
    it("BreadcrumbList に position が連番で入る", () => {
        const data = generateBreadcrumbStructuredData([
            { name: "Home", url: "https://example.com" },
            { name: "Photo", url: "https://example.com/photo/1" },
        ]);
        expect(data["@type"]).toBe("BreadcrumbList");
        const items = data.itemListElement as Array<{ position: number }>;
        expect(items[0].position).toBe(1);
        expect(items[1].position).toBe(2);
    });
});

describe("generateOrganizationStructuredData", () => {
    it("Organization スキーマを返す", () => {
        const data = generateOrganizationStructuredData();
        expect(data["@type"]).toBe("Organization");
        expect(data.url).toBe(siteConfig.url);
    });
});

describe("generateWebSiteStructuredData", () => {
    it("WebSite スキーマを返す", () => {
        const data = generateWebSiteStructuredData();
        expect(data["@type"]).toBe("WebSite");
        expect(data.url).toBe(siteConfig.url);
    });
});
