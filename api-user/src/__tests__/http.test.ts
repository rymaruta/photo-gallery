import { describe, it, expect } from "vitest";
import { getUserId, isAdmin, parseGroupsClaim, jsonError, JSON_HEADERS } from "../http";

// これは api/src/auth.ts の**複製**で、あちらにだけテストがある
// （api/src/__tests__/auth.test.ts）。2つが食い違っても気づけない状態だった。
// 同じ入力を当てて、対であることをテストでも示す。
//
// parseGroupsClaim が要るのは、API Gateway (HTTP API) の JWT オーソライザーが
// 配列クレームを "[admin user]"（引用符なし・スペース区切り）という
// JSON として不正な文字列に変換して渡すため。JSON.parse だけでは読めない。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ev = (claims: Record<string, unknown>): any => ({
    requestContext: { authorizer: { jwt: { claims } } },
});

describe("parseGroupsClaim", () => {
    it("API Gateway HTTP API 形式 '[admin user]' を解釈できる", () => {
        expect(parseGroupsClaim("[admin user]")).toEqual(["admin", "user"]);
    });

    it("単一グループの '[admin]' を解釈できる", () => {
        expect(parseGroupsClaim("[admin]")).toEqual(["admin"]);
    });

    it("ブラケット内カンマ区切り '[admin,user]' も解釈できる", () => {
        expect(parseGroupsClaim("[admin,user]")).toEqual(["admin", "user"]);
    });

    it('正しい JSON 文字列 \'["admin","user"]\' も解釈できる', () => {
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
});

describe("isAdmin", () => {
    it("admin を含むときだけ true", () => {
        expect(isAdmin(ev({ "cognito:groups": "[admin user]" }))).toBe(true);
        expect(isAdmin(ev({ "cognito:groups": "[user]" }))).toBe(false);
        expect(isAdmin(ev({}))).toBe(false);
    });

    it("紛らわしい名前を admin と誤認しない", () => {
        expect(isAdmin(ev({ "cognito:groups": "[administrator]" }))).toBe(false);
        expect(isAdmin(ev({ "cognito:groups": "[not-admin]" }))).toBe(false);
    });
});

describe("getUserId", () => {
    it("sub を返す", () => {
        expect(getUserId(ev({ sub: "u1" }))).toBe("u1");
    });

    it("sub が無ければ空文字（呼び出し側が弾けるように）", () => {
        // 各ハンドラはこれを見て 401 を返す。undefined や "undefined" を
        // 返すと、そのままキーの一部になって全員が同じ場所を共有する。
        expect(getUserId(ev({}))).toBe("");
    });
});

describe("jsonError", () => {
    it("状態コードと日本語の理由を JSON で返す", () => {
        const res = jsonError(404, "写真が見つかりません");
        expect(res.statusCode).toBe(404);
        expect(res.headers).toEqual(JSON_HEADERS);
        expect(JSON.parse(res.body)).toEqual({ error: "写真が見つかりません" });
    });
});
