import { describe, it, expect } from "vitest";
import { parseGroupsClaim, getCallerUserId } from "../auth";

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

// sub 欠落は ""（対の api-user/src/http.ts と同じ）。以前は "unknown" を
// 返していて、savePhoto が userId:"unknown" の写真——持ち主が存在せず
// 本人画面から消せない行——を作れた。
describe("getCallerUserId", () => {
    const ev = (claims: Record<string, unknown>) => ({
        requestContext: { authorizer: { jwt: { claims } } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    it("sub をそのまま返す", () => {
        expect(getCallerUserId(ev({ sub: "user-1" }))).toBe("user-1");
    });

    it('sub が無ければ ""（"unknown" という架空の持ち主を作らない）', () => {
        expect(getCallerUserId(ev({}))).toBe("");
        expect(getCallerUserId(ev({ sub: undefined }))).toBe("");
    });
});
