import { describe, it, expect } from "vitest";
import { capitalize } from "../string";

describe("capitalize", () => {
    it("先頭を大文字、残りを小文字に変換する", () => {
        expect(capitalize("hello")).toBe("Hello");
        expect(capitalize("WORLD")).toBe("World");
        expect(capitalize("hELLO wORLD")).toBe("Hello world");
    });

    it("空文字はそのまま返す", () => {
        expect(capitalize("")).toBe("");
    });

    it("1文字でも動作する", () => {
        expect(capitalize("a")).toBe("A");
        expect(capitalize("Z")).toBe("Z");
    });
});
