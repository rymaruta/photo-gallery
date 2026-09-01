import { describe, it, expect } from "vitest";
import { selectVisiblePhotos } from "../visiblePhotos";
import type { Photo } from "@/lib/data/photos";

const P = (id: string, o: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn/${id}.jpg`, title: id, tags: [], ...o,
} as Photo);

const ids = (list: Photo[]) => list.map((p) => p.id);
const base = { query: "", status: "all" as const, sort: "new" as const };

// **綴りを見るガードでは足りなかった。** 以前は「`compareAdmin(` を
// 呼んでいる行が1本ある」ことしか見ておらず、`sort === "new"` を
// `sort !== "new"` に取り違えても——つまり「新しい順」ボタンが古い順に
// 並べても——全テストが緑のままだった。向きそのものを確かめる。
describe("管理画面の一覧（絞り込みと並び）", () => {
    const older = P("older", { date: "2024-01-01" });
    const newer = P("newer", { date: "2026-01-01" });

    it("「新しい順」は新しい方が先", () => {
        expect(ids(selectVisiblePhotos([older, newer], base))).toEqual(["newer", "older"]);
    });

    it("「古い順」は逆", () => {
        expect(ids(selectVisiblePhotos([newer, older], { ...base, sort: "old" }))).toEqual(["older", "newer"]);
    });

    // 同じ日に撮った複数枚は普通にある（日付だけの `date`）。決着は
    // **最後に手を入れた順**——id で決めると UUID の大小という無意味な順に
    // 固定され、サイト側とも旧実装とも逆になる（実データで実測した）
    it("同じ日付なら、最後に手を入れた方が先", () => {
        const early = P("aaa", { date: "2026-04-29", updatedAt: "2026-04-29T07:30:00Z" });
        const late = P("zzz", { date: "2026-04-29", updatedAt: "2026-04-29T13:25:00Z" });
        expect(ids(selectVisiblePhotos([early, late], base)), "id の大小で決めている").toEqual(["zzz", "aaa"]);
    });

    it("下書きだけ / 公開だけで絞れる", () => {
        const draft = P("draft", { published: false, date: "2025-01-01" });
        const pub = P("pub", { published: true, date: "2025-01-02" });
        expect(ids(selectVisiblePhotos([draft, pub], { ...base, status: "draft" }))).toEqual(["draft"]);
        expect(ids(selectVisiblePhotos([draft, pub], { ...base, status: "published" }))).toEqual(["pub"]);
        expect(ids(selectVisiblePhotos([draft, pub], base)).sort()).toEqual(["draft", "pub"]);
    });

    it("検索はタイトル・場所・カテゴリ・タグを見る（大小を無視）", () => {
        const list = [
            P("byTitle", { title: "京都の朝" }),
            P("byLocation", { location: "Kyoto" }),
            P("byTag", { tags: ["寺"] }),
            P("other", { title: "札幌" }),
        ];
        expect(ids(selectVisiblePhotos(list, { ...base, query: "京都" }))).toEqual(["byTitle"]);
        expect(ids(selectVisiblePhotos(list, { ...base, query: "kYoTo" })), "大小を見ている").toEqual(["byLocation"]);
        expect(ids(selectVisiblePhotos(list, { ...base, query: "寺" }))).toEqual(["byTag"]);
    });

    it("元の配列を書き換えない", () => {
        const list = [older, newer];
        selectVisiblePhotos(list, base);
        expect(ids(list)).toEqual(["older", "newer"]);
    });
});
