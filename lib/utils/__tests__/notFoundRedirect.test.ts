import { describe, it, expect } from "vitest";
import { resolveNotFoundRedirect } from "../notFoundRedirect";

describe("resolveNotFoundRedirect", () => {
    it("/photo/<id> はモーダル表示URLへ", () => {
        expect(resolveNotFoundRedirect("/photo/abc-123")).toBe("/?photo=abc-123");
    });

    it(".html 付き・末尾スラッシュ付きも解決できる", () => {
        expect(resolveNotFoundRedirect("/photo/abc.html")).toBe("/?photo=abc");
        expect(resolveNotFoundRedirect("/photo/abc/")).toBe("/?photo=abc");
    });

    it("/users/<id> はクエリ版プロフィールへ", () => {
        expect(resolveNotFoundRedirect("/users/uid-1")).toBe("/users?id=uid-1");
        expect(resolveNotFoundRedirect("/users/uid-1.html")).toBe("/users?id=uid-1");
    });

    it("id は URL エンコードされる", () => {
        expect(resolveNotFoundRedirect("/photo/a b")).toBe(`/?photo=${encodeURIComponent("a b")}`);
    });

    it("その他のパスは null（通常の404表示）", () => {
        expect(resolveNotFoundRedirect("/unknown")).toBeNull();
        expect(resolveNotFoundRedirect("/photo/")).toBeNull();
        expect(resolveNotFoundRedirect("/users/")).toBeNull();
        expect(resolveNotFoundRedirect("/photo/a/b")).toBeNull();
        expect(resolveNotFoundRedirect("/")).toBeNull();
    });
});
