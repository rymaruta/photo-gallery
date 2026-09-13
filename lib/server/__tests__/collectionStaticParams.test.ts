import { describe, it, expect, vi } from "vitest";
import type { Photo } from "../../data/photos";

/**
 * **統合前の URL をページとして残す配線。**
 *
 * 別名表でカテゴリとタグを統合すると、`/category/風景` `/tag/風景` は
 * 生成されなくなる。静的エクスポート（`dynamicParams=false`）には
 * リダイレクトの層が無いので、消すと**ハード404**——外部リンクと、
 * 既に Google が持っている URL を落とす。
 *
 * `legacyCategorySlugs` / `legacyTagSlugs` の中身は
 * `lib/utils/__tests__` で見ている。**ここで見るのは「呼んでいるか」**
 * ——タグ側の配線を外しても、他の625件は1つも落ちなかった
 * （この台帳が何度も記録している「関数は書いたが配線していない」）。
 */
const photos: Photo[] = [
    { id: "a", src: "https://cdn/a.jpg", category: "風景", tags: ["建物", "高屋神社"] },
    { id: "b", src: "https://cdn/b.jpg", category: "landscape", tags: ["architecture"] },
] as Photo[];

vi.mock("../photos", () => ({ loadAllPhotos: async () => photos }));

const { collectionStaticParams } = await import("../collections");

const slugs = async (type: "tag" | "category", key: string) =>
    (await collectionStaticParams(type, key)).map((p) => (p as Record<string, string>)[key]);

describe("集約ページの静的パス", () => {
    it("統合後のスラッグを出す", async () => {
        expect(await slugs("tag", "tag")).toContain("architecture");
        expect(await slugs("category", "category")).toContain("landscape");
    });

    // **本題。** ここが抜けると /tag/建物 がハード404になる
    it("統合前のタグの URL も残す", async () => {
        expect(await slugs("tag", "tag"), "/tag/建物 が生成されない＝ハード404").toContain("建物");
    });

    it("統合前のカテゴリの URL も残す", async () => {
        expect(await slugs("category", "category"), "/category/風景 が生成されない").toContain("風景");
    });

    // 統合の必要がない語で無駄なページを増やさない
    it("寄せる必要のない語は旧URLを作らない", async () => {
        const out = await slugs("tag", "tag");
        expect(out.filter((s) => s === "高屋神社")).toHaveLength(1);
    });
});
