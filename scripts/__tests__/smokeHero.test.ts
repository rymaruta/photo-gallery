import { describe, it, expect } from "vitest";
import { heroKeys } from "../lib/smokeHero.mjs";

/**
 * スモークの「写真ページ: 主役の写真が出る」が使う鍵。
 * 2026-09-26 00:37 の本番再ビルド（run 429）は、ファイル名が写真の id と
 * 別の写真（今の投稿の置き方）が先頭に来て `hero=0` で止まった。
 */
describe("主役の1枚を見分ける鍵", () => {
    it("昔の置き方（uploads/<写真の id>.jpg）は写真の id だけ", () => {
        expect(heroKeys("a129", [{ id: "a129", src: "https://d1s3dwwzgxf5ni.cloudfront.net/uploads/a129.jpg" }])).toEqual(["a129"]);
    });

    it("🔴 今の置き方（uploads/<投稿者>/<ファイル>.jpg）はファイル名も鍵にする", () => {
        const photos = [{
            id: "1d98af4d-9b73-5246-bcec-2a42b199d190",
            src: "https://journey-photo.com/uploads/67d49a68-80f1-7083-b0e0-c767886ef868/0ada6246-7ef6-4713-aafe-3e691253551a.jpg",
        }];
        const keys = heroKeys("1d98af4d-9b73-5246-bcec-2a42b199d190", photos);
        expect(keys).toContain("0ada6246-7ef6-4713-aafe-3e691253551a");
        // 実際の画面の src（派生も同じ名前を引き継ぐ）を主役と数えられる
        const src = "https://journey-photo.com/uploads/67d49a68-80f1-7083-b0e0-c767886ef868/0ada6246-7ef6-4713-aafe-3e691253551a.jpg";
        expect(keys.some((k) => src.includes(k))).toBe(true);
    });

    it("写真データに無い・src が無い・壊れた URL でも写真の id は残る", () => {
        expect(heroKeys("x", [])).toEqual(["x"]);
        expect(heroKeys("x", [{ id: "x" }])).toEqual(["x"]);
        expect(heroKeys("x", [{ id: "x", src: "http://[" }])).toEqual(["x"]);
    });
});
