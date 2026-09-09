import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// **集約ページのルートは、種類ごとに手書きのファイルが要る。**
// `CollectionType` に種類を足しても、`app/<パス>/[<セグメント>]/page.tsx` を
// 置き忘れる／`collectionStaticParams` の第2引数をフォルダ名と違う値にする／
// `type="tag"` を貼り間違える、のどれも **tsc は通します**
// （`checks.yml` はビルドを走らせず、しかも手動実行のみ）。
// 気づくのは手動の Deploy Site を流したときで、それまで**ページが1枚も
// 生成されないか、全部同じ種類の中身になる**。
//
// camera を足したとき、ルートを見るテストが1本も無かった（レビュー指摘）。
const ROOT = join(__dirname, "..", "..");

/** `CollectionType` と URL の区切りの対応（collections.ts の TYPE_PATH と対） */
const TYPES: Array<{ type: string; path: string; seg: string }> = [
    { type: "tag", path: "tag", seg: "tag" },
    { type: "location", path: "location", seg: "location" },
    { type: "category", path: "category", seg: "category" },
    { type: "camera", path: "camera", seg: "camera" },
];

describe("集約ページのルート", () => {
    it.each(TYPES)("$type のページファイルがある", ({ path, seg }) => {
        expect(existsSync(join(ROOT, "app", path, `[${seg}]`, "page.tsx")),
            `app/${path}/[${seg}]/page.tsx が無い`).toBe(true);
    });

    it.each(TYPES)("$type は自分の種類とセグメントで組む", ({ type, path, seg }) => {
        const src = readFileSync(join(ROOT, "app", path, `[${seg}]`, "page.tsx"), "utf8")
            .replace(/^\s*\/\/.*$/gm, " ");
        // 種類の貼り間違い（camera のページが type="tag" を渡す）を止める
        expect(src, `collectionStaticParams の種類/セグメントが違う`)
            .toContain(`collectionStaticParams("${type}", "${seg}")`);
        expect(src, `collectionMetadata の種類が違う`).toContain(`collectionMetadata("${type}"`);
        expect(src, `CollectionPage の種類が違う`).toContain(`type="${type}"`);
        // 列挙外を404にする（静的書き出しの前提）
        expect(src).toContain("dynamicParams = false");
    });

    // **TYPE_PATH と食い違っていないか。** URL の区切りだけ変えると、
    // リンク先とページの場所がずれて全部404になる
    it("collections.ts の TYPE_PATH と一致する", () => {
        const src = readFileSync(join(ROOT, "lib", "utils", "collections.ts"), "utf8");
        const m = /const TYPE_PATH: Record<CollectionType, string> = \{([^}]*)\}/.exec(src);
        expect(m, "TYPE_PATH が見つからない（書き方が変わった？）").not.toBeNull();
        for (const { type, path } of TYPES) {
            expect(m![1]).toContain(`${type}: "${path}"`);
        }
    });

    // 404救済も種類ごとに手書き。落とすと、ビルド前の新しい値が行き止まりになる
    it("404 の振り替えが全種類ぶんある", () => {
        const src = readFileSync(join(ROOT, "lib", "utils", "notFoundRedirect.ts"), "utf8")
            .replace(/^\s*\/\/.*$/gm, " ");
        for (const { path } of TYPES) {
            expect(src, `/${path}/ の振り替えが無い`).toContain(`/^\\/${path}\\/`);
        }
    });
});
