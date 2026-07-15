import { describe, it, expect } from "vitest";
import { ja, en, getLabels } from "../labels";

describe("i18n labels", () => {
    describe("category.names", () => {
        it("日英でカテゴリキーが一致する", () => {
            const enKeys = Object.keys(en.category.names ?? {}).sort();
            const jaKeys = Object.keys(ja.category.names ?? {}).sort();
            expect(enKeys).toEqual(jaKeys);
        });

        it("英語に street が定義されている", () => {
            expect(en.category.names?.street).toBe("Street");
        });

        it("日本語に street が定義されている", () => {
            expect(ja.category.names?.street).toBe("街");
        });

        it("全カテゴリが空文字でない", () => {
            Object.entries(en.category.names ?? {}).forEach(([key, value]) => {
                expect(value, `en.category.names.${key}`).toBeTruthy();
            });
            Object.entries(ja.category.names ?? {}).forEach(([key, value]) => {
                expect(value, `ja.category.names.${key}`).toBeTruthy();
            });
        });
    });

    describe("navigation", () => {
        it("日英でナビゲーションキーが一致する", () => {
            const enNavKeys = Object.keys(en.navigation ?? {}).sort();
            const jaNavKeys = Object.keys(ja.navigation ?? {}).sort();
            expect(enNavKeys).toEqual(jaNavKeys);
        });

        it("必須ナビゲーションキーが存在する", () => {
            const required = ["works", "gallery", "about", "favorites", "login", "logout"] as const;
            required.forEach((key) => {
                expect(en.navigation?.[key], `en.navigation.${key}`).toBeTruthy();
                expect(ja.navigation?.[key], `ja.navigation.${key}`).toBeTruthy();
            });
        });
    });

    describe("getLabels", () => {
        it("ja を指定すると日本語ラベルを返す", () => {
            const labels = getLabels("ja");
            expect(labels.category.title).toBe("カテゴリ");
        });

        it("en を指定すると英語ラベルを返す", () => {
            const labels = getLabels("en");
            expect(labels.category.title).toBe("Category");
        });

        it("locale 未指定時のデフォルトは ja", () => {
            const labels = getLabels();
            expect(labels.category.title).toBe("カテゴリ");
        });
    });

    describe("sort options", () => {
        it("日英で sort.options キーが一致する", () => {
            const enSortKeys = Object.keys(en.sort.options).sort();
            const jaSortKeys = Object.keys(ja.sort.options).sort();
            expect(enSortKeys).toEqual(jaSortKeys);
        });
    });
});
