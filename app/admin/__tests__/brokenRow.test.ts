import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectVisiblePhotos } from "../visiblePhotos";
import { usablePhotoRows } from "../../../lib/utils/apiRows";
import type { Photo } from "../../../lib/data/photos";

// **管理画面も同じ壊れ方をする。**
//
// 一覧は `setPhotos([...data])` で「配列でない応答をここで投げる」ことは
// していたが、**中身が壊れている行は素通り**していた。`selectVisiblePhotos`
// の `p.published` と `photoSearchText(p)` は描画中に読むので、1件の `null` で
// 管理画面ごと `ErrorBoundary` のカードになる。
//
// 一般利用者の画面より優先度は下（管理者専用で、壊れた行が入るのと同じ経路で
// 管理者が気づく）が、直し方は同じなので揃える。
const opts = { query: "", status: "all" as const, sort: "new" as const };

describe("管理画面の一覧", () => {
    it("読めない行を渡すと描画前に落ちる（ふるいが要る理由）", () => {
        const rows = [{ id: "a", src: "x.jpg" }, null] as unknown as Photo[];
        expect(() => selectVisiblePhotos(rows, opts)).toThrow(TypeError);
    });

    it("ふるいを通せば、残りは並ぶ", () => {
        const rows = usablePhotoRows<Photo>(
            [{ id: "a", src: "x.jpg" }, null, { id: "b", src: "y.jpg" }], "x");
        expect(() => selectVisiblePhotos(rows!, opts)).not.toThrow();
        expect(selectVisiblePhotos(rows!, opts).map((p) => p.id).sort()).toEqual(["a", "b"]);
    });

    // 絞り込み・検索も同じ行を読む
    it("検索でも落ちない", () => {
        const rows = usablePhotoRows<Photo>(
            [{ id: "a", src: "x.jpg", location: "京都" }, null], "x");
        expect(selectVisiblePhotos(rows!, { ...opts, query: "京都" }).map((p) => p.id)).toEqual(["a"]);
    });
});

// **配線**（単体は固定・配線は無防備、を3周繰り返している）
describe("管理画面がふるいを通している", () => {
    const ROOT = join(__dirname, "..", "..", "..");
    const codeOf = (rel: string) =>
        readFileSync(join(ROOT, rel), "utf8")
            .replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, "$1")
            .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");

    it.each([
        "app/admin/page.tsx",
        "app/admin/edit/page.tsx",
    ])("%s", (rel) => {
        expect(codeOf(rel), "ふるいを通さずに状態へ入れている")
            .toMatch(/usablePhotoRows\s*(<[^>]*>)?\s*\(/);
    });
});
