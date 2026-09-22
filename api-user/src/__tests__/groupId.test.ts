import { describe, it, expect } from "vitest";
import { sanitizeGroupId } from "../sanitize";

describe("sanitizeGroupId", () => {
    it("UUID をそのまま通す", () => {
        const id = "3F2504E0-4F89-11D3-9A0C-0305E82C3301";
        expect(sanitizeGroupId(id)).toBe(id);
        expect(sanitizeGroupId("abc-123")).toBe("abc-123");
    });

    /// **まとめない方に倒す。** 変な値でまとまると、関係のない写真が
    /// 同じ投稿に見える（まとめ損なっても写真は1枚ずつ出るだけ）
    it("英数字とハイフン以外は通さない", () => {
        expect(sanitizeGroupId("../other")).toBeUndefined();
        expect(sanitizeGroupId("a b")).toBeUndefined();
        expect(sanitizeGroupId("<script>")).toBeUndefined();
        expect(sanitizeGroupId("グループ")).toBeUndefined();
        expect(sanitizeGroupId("a\nb")).toBeUndefined();
    });

    it("長すぎる値と空は通さない", () => {
        expect(sanitizeGroupId("a".repeat(65))).toBeUndefined();
        expect(sanitizeGroupId("a".repeat(64))).toBe("a".repeat(64));
        expect(sanitizeGroupId("   ")).toBeUndefined();
        expect(sanitizeGroupId("")).toBeUndefined();
    });

    it("文字列以外は通さない", () => {
        expect(sanitizeGroupId(undefined)).toBeUndefined();
        expect(sanitizeGroupId(123)).toBeUndefined();
        expect(sanitizeGroupId({ groupId: "a" })).toBeUndefined();
    });
});
