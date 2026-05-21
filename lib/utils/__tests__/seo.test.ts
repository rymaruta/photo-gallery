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
