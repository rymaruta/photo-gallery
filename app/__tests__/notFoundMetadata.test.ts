import { describe, it, expect } from "vitest";
import { metadata } from "../not-found";

/**
 * **404 は索引に入れない、と1か所で読めるようにする。**
 *
 * 中身（`NotFoundClient`）は `"use client"` で、クライアント部品は
 * `metadata` を export できない。そのため実ビルドの `out/404.html` は
 * **矛盾した2つの `robots`** を出していた（2026-09-12 に確認）:
 *
 *     <meta name="robots" content="noindex"/>        ← Next が 404 に自動で付ける
 *     <meta name="robots" content="index, follow"/>  ← ルートの layout
 *
 * Google は最も制限の強いものを採るので実害は出ていなかったが、
 * **どちらが意図か次に読む人に分からない**。このリポジトリは `robots` の
 * 差し替えで一度事故を起こしている（`412477e`）。
 *
 * **重複そのものは消せない**——Next が自動で入れる側は止められない。
 * 消したのは**矛盾**（修正後は `noindex` と `noindex, follow`）。
 */
describe("404 のメタデータ", () => {
    it("索引に入れない（ルートの index, follow を上書きする）", () => {
        expect(metadata.robots, "robots を書いていない＝ルートの index が効く").toBeDefined();
        expect(metadata.robots).toEqual({ index: false, follow: true });
    });

    // **リンクは辿らせる。** 404 にもヘッダー・フッターのリンクがあり、
    // `follow: false` にすると、そこからの経路を閉じることになる
    it("リンクは辿ってよい", () => {
        expect((metadata.robots as { follow?: boolean }).follow).toBe(true);
    });
});
