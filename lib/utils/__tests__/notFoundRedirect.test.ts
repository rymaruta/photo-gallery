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

// 写真を編集して新しいタグや撮影地を付けると、その写真のページにはリンクが
// 出るのに、次のビルド（最大6時間後）までリンク先が存在せずハード404になる。
// 静的エクスポート + dynamicParams=false なのでリダイレクトの層が無い。
describe("resolveNotFoundRedirect: 集約ページの救済", () => {
    it("タグは「さがす」のタグ絞り込みへ", () => {
        expect(resolveNotFoundRedirect("/tag/winter")).toBe("/search?tags=winter");
    });

    it("カテゴリは「さがす」のカテゴリ絞り込みへ", () => {
        expect(resolveNotFoundRedirect("/category/landscape")).toBe("/search?category=landscape");
    });

    it("撮影地は専用フィルタが無いのでフリーワード検索へ", () => {
        expect(resolveNotFoundRedirect("/location/paris")).toBe("/search?q=paris");
    });

    it("日本語スラッグはデコードしてから絞り込み値にする", () => {
        expect(resolveNotFoundRedirect("/tag/%E9%9B%AA")).toBe("/search?tags=%E9%9B%AA");
        expect(resolveNotFoundRedirect("/location/%E6%9D%B1%E4%BA%AC")).toBe("/search?q=%E6%9D%B1%E4%BA%AC");
    });

    it(".html 付き・末尾スラッシュ付きでも救済する", () => {
        expect(resolveNotFoundRedirect("/tag/winter.html")).toBe("/search?tags=winter");
        expect(resolveNotFoundRedirect("/category/landscape/")).toBe("/search?category=landscape");
    });

    it("入れ子や見覚えのないパスは救済しない", () => {
        expect(resolveNotFoundRedirect("/tag/a/b")).toBeNull();
        expect(resolveNotFoundRedirect("/whatever")).toBeNull();
    });
});
