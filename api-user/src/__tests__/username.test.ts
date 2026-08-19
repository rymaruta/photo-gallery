import { describe, it, expect, vi } from "vitest";

// DynamoDB は使わない純関数だけを検証する
vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: class { send() { return Promise.resolve({}); } },
    GetItemCommand: class {},
    PutItemCommand: class {},
    DeleteItemCommand: class {},
}));

import { normalizeUsername, USERNAME_RE, RESERVED_USERNAMES } from "../userProfile";

describe("normalizeUsername", () => {
    it("小文字化し、先頭の @ を落とす", () => {
        expect(normalizeUsername("@Ryuhei_Photo").username).toBe("ryuhei_photo");
        expect(normalizeUsername("  ryuhei  ").username).toBe("ryuhei");
    });

    it("空・null はクリア扱い（エラーにしない）", () => {
        expect(normalizeUsername("")).toEqual({});
        expect(normalizeUsername(null)).toEqual({});
        expect(normalizeUsername("   ")).toEqual({});
    });

    it("記号・空白・大文字以外の文字は弾く", () => {
        expect(normalizeUsername("ryu hei").error).toBeTruthy();
        expect(normalizeUsername("ryu-hei").error).toBeTruthy();
        expect(normalizeUsername("日本語").error).toBeTruthy();
        expect(normalizeUsername("a@b").error).toBeTruthy();
    });

    it("長さ制限（3〜20文字）", () => {
        expect(normalizeUsername("ab").error).toBeTruthy();
        expect(normalizeUsername("abc").username).toBe("abc");
        expect(normalizeUsername("a".repeat(20)).username).toBe("a".repeat(20));
        expect(normalizeUsername("a".repeat(21)).error).toBeTruthy();
    });

    it("予約語は使えない（ルート衝突・なりすまし・紛らわしい語）", () => {
        for (const w of ["photo", "tag", "camera", "login", "official", "staff", "support", "null", "guest"]) {
            expect(normalizeUsername(w).error).toBeTruthy();
        }
    });

    it("admin は誰も使えない（予約語）", () => {
        expect(normalizeUsername("admin").error).toBeTruthy();
        expect(normalizeUsername("@Admin").error).toBeTruthy();
    });

    it("通常のユーザー名は通る", () => {
        expect(normalizeUsername("ryuhei").username).toBe("ryuhei");
        expect(normalizeUsername("@Ryuhei_01").username).toBe("ryuhei_01");
    });

    it("文字列以外はエラー", () => {
        expect(normalizeUsername(123).error).toBeTruthy();
        expect(normalizeUsername({}).error).toBeTruthy();
    });
});

describe("USERNAME_RE / RESERVED_USERNAMES", () => {
    it("規則は英小文字・数字・_ の3〜20文字", () => {
        expect(USERNAME_RE.test("ryuhei_01")).toBe(true);
        expect(USERNAME_RE.test("Ryuhei")).toBe(false);
        expect(USERNAME_RE.test("ab")).toBe(false);
    });
    it("主要ルート名が予約されている", () => {
        for (const w of ["users", "photo", "tag", "location", "category", "camera", "lens", "upload", "drafts"]) {
            expect(RESERVED_USERNAMES.has(w)).toBe(true);
        }
    });

    it("なりすまし系も予約されている", () => {
        for (const w of ["official", "staff", "support", "administrator", "journeyphoto"]) {
            expect(RESERVED_USERNAMES.has(w)).toBe(true);
        }
    });

    it("admin も予約されている", () => {
        expect(RESERVED_USERNAMES.has("admin")).toBe(true);
    });
});
