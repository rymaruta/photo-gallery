import { describe, it, expect } from "vitest";
import { parseGroupsClaim } from "../auth";

describe("parseGroupsClaim", () => {
    it("API Gateway HTTP API 形式 '[admin user]'（引用符なし・スペース区切り）を解釈できる", () => {
        expect(parseGroupsClaim("[admin user]")).toEqual(["admin", "user"]);
    });

    it("単一グループの '[admin]' を解釈できる", () => {
        expect(parseGroupsClaim("[admin]")).toEqual(["admin"]);
    });

    it("正しい JSON 文字列 '[\"admin\",\"user\"]' も解釈できる", () => {
        expect(parseGroupsClaim('["admin","user"]')).toEqual(["admin", "user"]);
    });

    it("実際の配列はそのまま返す", () => {
        expect(parseGroupsClaim(["admin", "user"])).toEqual(["admin", "user"]);
    });

    it("カンマ区切り文字列を解釈できる", () => {
        expect(parseGroupsClaim("admin,user")).toEqual(["admin", "user"]);
    });

    it("未定義・null・空文字は空配列", () => {
        expect(parseGroupsClaim(undefined)).toEqual([]);
        expect(parseGroupsClaim(null)).toEqual([]);
        expect(parseGroupsClaim("")).toEqual([]);
    });

    it("ブラケット内カンマ区切り '[admin,user]' も解釈できる", () => {
        expect(parseGroupsClaim("[admin,user]")).toEqual(["admin", "user"]);
    });
});
