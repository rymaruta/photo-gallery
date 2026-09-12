import { describe, it, expect } from "vitest";
import { collectEntries, photosInCollection, isIndexableCollection, legacyTagSlugs, canonicalCollectionPath } from "../collections";
import { collectOwnValues } from "../ownValues";
import type { Photo } from "../../data/photos";

/**
 * **タグの日英を寄せる。**
 *
 * 実データで測ると、同じ主題が**別々の写真に別の言語で**付いていた:
 *
 *     風景 3枚 / landscape 1枚      ご飯 1枚 / restaurant 3枚
 *     自然 2枚 / nature 3枚         建物 1枚 / architecture 2枚
 *
 * どちらも 3枚（`MIN_INDEXABLE_COUNT`）に届かず**両方 noindex**。
 * 62ページ中55が検索に出ていない状態の、いちばん直せる部分。
 */
const P = (over: Partial<Photo>): Photo =>
    ({ id: Math.random().toString(36).slice(2), src: "https://cdn/x.jpg", ...over } as Photo);

// 実データの割れ方をそのまま写した（同じ写真に両方付いているのではなく、別々の写真）
const photos: Photo[] = [
    P({ id: "j1", tags: ["風景"] }), P({ id: "j2", tags: ["風景"] }), P({ id: "j3", tags: ["風景"] }),
    P({ id: "e1", tags: ["landscape"] }),
    P({ id: "b1", tags: ["建物"] }), P({ id: "b2", tags: ["architecture"] }), P({ id: "b3", tags: ["architecture"] }),
    P({ id: "x1", tags: ["高屋神社"] }),
];

describe("タグの日英を1ページに寄せる", () => {
    it("風景 と landscape が同じページになる", () => {
        const ids = photosInCollection(photos, "tag", "landscape").map((p) => p.id).sort();
        expect(ids, "日英が別ページのまま").toEqual(["e1", "j1", "j2", "j3"]);
    });

    it("旧URL（/tag/風景）でも同じ写真が出る", () => {
        const ids = photosInCollection(photos, "tag", "風景").map((p) => p.id).sort();
        expect(ids).toEqual(["e1", "j1", "j2", "j3"]);
    });

    // **これが目的。** 寄せる前はどちらも3枚未満で両方 noindex だった
    it("寄せた結果、検索に出せる枚数になる", () => {
        const entries = collectEntries(photos, "tag");
        const arch = entries.find((e) => e.slug === "architecture");
        expect(arch?.count, "建物1枚 + architecture2枚 が寄っていない").toBe(3);
        expect(isIndexableCollection(arch!.count, "tag"), "3枚あるのに noindex のまま").toBe(true);
        // 寄せる前の姿（別ページ）が残っていないこと
        expect(entries.map((e) => e.slug)).not.toContain("建物");
        expect(entries.map((e) => e.slug)).not.toContain("風景");
    });

    // **固有名詞は寄せない。** 表に無い語はそのまま＝長い語で1位を狙う側
    it("固有名詞のタグはそのまま残る", () => {
        expect(collectEntries(photos, "tag").map((e) => e.slug)).toContain("高屋神社");
    });

    // **旧URLを404にしない。** 静的エクスポートにはリダイレクトの層が無い
    it("統合前の名前もページとして残す", () => {
        const legacy = legacyTagSlugs(photos);
        expect(legacy, "/tag/風景 がハード404になる").toContain("風景");
        expect(legacy).toContain("建物");
        // 統合の必要がない語は「旧URL」ではない（無駄なページを作らない）
        expect(legacy).not.toContain("高屋神社");
        expect(legacy).not.toContain("landscape");
    });

    // **評価は統合後へ寄せる。** 旧URLが別ページとして競合しない
    it("旧URLの canonical は統合後を指す", () => {
        expect(canonicalCollectionPath("tag", "風景")).toBe(canonicalCollectionPath("tag", "landscape"));
    });

    // **入力画面の候補も1つにまとまる。** ここが割れていると、
    // 次に入力する人がまた揺れを作る（＝寄せても増え続ける）
    it("入力候補のチップが日英で二重に出ない", () => {
        const tags = collectOwnValues(photos).tags;
        const both = tags.filter((t) => t === "風景" || t === "landscape");
        expect(both.length, "同じ主題のチップが2つ並んでいる").toBe(1);
        expect(tags).toContain("高屋神社");
    });
});
