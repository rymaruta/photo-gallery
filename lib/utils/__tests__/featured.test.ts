import { describe, it, expect } from "vitest";
import { featuredGroups, FEATURED_PER_CATEGORY, FEATURED_GROUPS_MAX } from "../featured";
import type { Photo } from "../../data/photos";

const NAMES = { landscape: "風景", architecture: "建築", nature: "自然", street: "街", animal: "動物" };
const P = (over: Partial<Photo>): Photo => ({ id: Math.random().toString(36), src: "s", featured: true, ...over }) as Photo;

describe("おすすめをカテゴリごとにまとめる", () => {
    it("印の付いた写真だけ出す", () => {
        const g = featuredGroups([
            P({ id: "a", category: "風景" }),
            P({ id: "b", category: "風景", featured: false }),
            P({ id: "c", category: "風景", featured: undefined }),
        ], NAMES);
        expect(g).toHaveLength(1);
        expect(g[0].photos.map((p) => p.id), "印の無い写真が出ている").toEqual(["a"]);
    });

    /** トップに出すのは誰でも見られるものだけ */
    it("非公開は印が付いていても出さない", () => {
        const g = featuredGroups([
            P({ id: "a", category: "風景" }),
            P({ id: "hidden", category: "風景", published: false }),
        ], NAMES);
        expect(g[0].photos.map((p) => p.id), "**非公開の写真がトップに出ている**").toEqual(["a"]);
    });

    /**
     * 🔴 **鍵はスラッグ。** 実データは英語で保存された写真の方が多く
     * （`landscape` 12枚 / `風景` 4枚）、綴りで分けると同じカテゴリが
     * 2つの塊に割れる
     */
    it("日本語と英語を同じ塊にする", () => {
        const g = featuredGroups([
            P({ id: "ja", category: "風景" }),
            P({ id: "en", category: "landscape" }),
            P({ id: "alias", category: "建物" }),
            P({ id: "arch", category: "architecture" }),
        ], NAMES);
        expect(g, "同じカテゴリが2つに割れている").toHaveLength(2);
        expect(g.map((x) => x.slug).sort()).toEqual(["architecture", "landscape"]);
    });

    it("表示名は表を通す（`建物` と書いてあっても「建築」と出す）", () => {
        const g = featuredGroups([P({ category: "建物" })], NAMES);
        expect(g[0].label).toBe("建築");
    });

    it("表に無いカテゴリは生のまま出す（空にしない）", () => {
        const g = featuredGroups([P({ category: "Travel" })], NAMES);
        expect(g[0].label, "名前が消えている").toBeTruthy();
    });

    /** 「その他」の塊を作ると、カテゴリごとに見せる目的から外れる */
    it("カテゴリを持たない写真は出さない", () => {
        expect(featuredGroups([P({ category: undefined }), P({ category: "  " })], NAMES)).toEqual([]);
    });

    it("1つのカテゴリに出す枚数を切る（トップが一覧の焼き直しにならない）", () => {
        const many = Array.from({ length: FEATURED_PER_CATEGORY + 5 }, (_, i) => P({ id: `p${i}`, category: "風景" }));
        expect(featuredGroups(many, NAMES)[0].photos).toHaveLength(FEATURED_PER_CATEGORY);
    });

    it("出すカテゴリの数も切る（トップが縦に伸びすぎない）", () => {
        const cats = ["風景", "建築", "自然", "街", "動物", "食べ物", "人物"];
        const photos = cats.flatMap((c) => [P({ category: c }), P({ category: c })]);
        expect(featuredGroups(photos, NAMES)).toHaveLength(FEATURED_GROUPS_MAX);
    });

    it("多い順に並べる（同数なら毎回同じ並び）", () => {
        const g = featuredGroups([
            P({ category: "建築" }),
            P({ category: "風景" }), P({ category: "風景" }), P({ category: "風景" }),
            P({ category: "自然" }), P({ category: "自然" }),
        ], NAMES);
        expect(g.map((x) => x.slug)).toEqual(["landscape", "nature", "architecture"]);
    });

    it("同数なら名前順で固定（配列の順で入れ替わらない）", () => {
        const a = featuredGroups([P({ category: "自然" }), P({ category: "建築" })], NAMES);
        const b = featuredGroups([P({ category: "建築" }), P({ category: "自然" })], NAMES);
        expect(a.map((x) => x.slug)).toEqual(b.map((x) => x.slug));
    });

    it("写真が無い・null でも落ちない", () => {
        expect(featuredGroups(null, NAMES)).toEqual([]);
        expect(featuredGroups([], NAMES)).toEqual([]);
        expect(featuredGroups([P({ category: "風景", featured: false })], NAMES)).toEqual([]);
    });
});
