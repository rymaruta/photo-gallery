import { describe, it, expect } from "vitest";
import { getAboutContent } from "../about";

describe("getAboutContent", () => {
    it("デフォルト（引数なし）は ja を返す", () => {
        const content = getAboutContent();
        expect(content.title).toBe("制作について");
    });

    it("'ja' → 日本語コンテンツを返す", () => {
        const content = getAboutContent("ja");
        expect(content.title).toBe("制作について");
        expect(content.photographer?.name).toBeTruthy();
    });

    it("'en' → 英語コンテンツを返す", () => {
        const content = getAboutContent("en");
        expect(content.title).toBe("About");
        expect(content.photographer?.title).toBe("Webmaster");
    });

    it("paragraphs が配列として存在する", () => {
        const ja = getAboutContent("ja");
        const en = getAboutContent("en");
        expect(Array.isArray(ja.paragraphs)).toBe(true);
        expect(Array.isArray(en.paragraphs)).toBe(true);
        expect(ja.paragraphs!.length).toBeGreaterThan(0);
    });

    it("contactUrl が有効な URL 形式", () => {
        const content = getAboutContent("ja");
        expect(content.contactUrl).toMatch(/^https?:\/\//);
    });

    it("日英で必須フィールドが揃っている", () => {
        const required = ["title", "description", "contactTitle", "contactPrompt"] as const;
        const ja = getAboutContent("ja");
        const en = getAboutContent("en");
        for (const key of required) {
            expect(ja[key], `ja.${key}`).toBeTruthy();
            expect(en[key], `en.${key}`).toBeTruthy();
        }
    });
});
