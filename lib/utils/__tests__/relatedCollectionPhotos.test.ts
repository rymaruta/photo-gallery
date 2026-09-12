import { describe, it, expect } from "vitest";
import { relatedCollectionPhotos } from "../related";
import { isIndexableCollection, MIN_INDEXABLE_LOCATION, MIN_INDEXABLE_COUNT } from "../collections";
import type { Photo } from "../../data/photos";

/**
 * **薄い集約ページを、読む価値のあるページにする。**
 *
 * 実データの `/location/*` は14ページ中10ページが写真2枚以下で、
 * 全部 noindex だった——「高屋神社」のような**具体語で1位を狙える
 * 唯一のページ**を、こちらから検索に出すなと言っている状態。
 */
const P = (o: Partial<Photo>): Photo => ({ src: "https://cdn/x.jpg", ...o } as Photo);

const all: Photo[] = [
    P({ id: "here", tags: ["雲海", "神社"], category: "風景", location: "高屋神社", createdAt: "2026-03-03T00:00:00Z" }),
    P({ id: "sameTag", tags: ["雲海"], category: "自然", createdAt: "2026-02-02T00:00:00Z" }),
    P({ id: "sameCat", tags: ["海"], category: "風景", createdAt: "2026-01-01T00:00:00Z" }),
    P({ id: "unrelated", tags: ["ご飯"], category: "ご飯", createdAt: "2026-04-04T00:00:00Z" }),
    P({ id: "hidden", tags: ["雲海"], category: "風景", published: false, createdAt: "2026-05-05T00:00:00Z" }),
];
const shown = [all[0]];

describe("集約ページの「ほかにこんな写真も」", () => {
    it("そのページに出ている写真は出さない", () => {
        expect(relatedCollectionPhotos(shown, all).map((p) => p.id)).not.toContain("here");
    });

    it("タグかカテゴリを共有する写真を出す", () => {
        const ids = relatedCollectionPhotos(shown, all).map((p) => p.id);
        expect(ids).toContain("sameTag");
        expect(ids).toContain("sameCat");
    });

    it("何も共有しない写真は出さない（水増しにしない）", () => {
        expect(relatedCollectionPhotos(shown, all).map((p) => p.id)).not.toContain("unrelated");
    });

    it("非公開は出さない", () => {
        expect(relatedCollectionPhotos(shown, all).map((p) => p.id)).not.toContain("hidden");
    });

    // **カテゴリの一致はタグ1つより重い**（点数 2 対 1）。ただし表示は新しい順
    it("近い順に選び、並びは新しい順に揃える", () => {
        const out = relatedCollectionPhotos(shown, all, 1);
        expect(out.map((p) => p.id), "点数の高い方を選んでいない").toEqual(["sameCat"]);
    });

    it("上限を超えない", () => {
        expect(relatedCollectionPhotos(shown, all, 1)).toHaveLength(1);
    });

    it("手がかりが無ければ空（無理に埋めない）", () => {
        expect(relatedCollectionPhotos([P({ id: "bare" })], all)).toEqual([]);
        expect(relatedCollectionPhotos([], all)).toEqual([]);
    });

    // **日英のタグでも近いと分かる**（`tagKey` を通しているか）
    it("タグの日英違いでも近いと判定する", () => {
        const jp = [P({ id: "a", tags: ["風景"] })];
        const pool = [...jp, P({ id: "b", tags: ["landscape"], createdAt: "2026-01-01T00:00:00Z" })];
        expect(relatedCollectionPhotos(jp, pool).map((p) => p.id)).toEqual(["b"]);
    });
});

describe("検索に載せる線は種別で分ける", () => {
    // **撮影地は固有名詞で、その写真はこのサイトにしか無い**
    it("撮影地は1枚から載せる", () => {
        expect(MIN_INDEXABLE_LOCATION).toBe(1);
        expect(isIndexableCollection(1, "location"), "具体語で狙える唯一のページを閉じている").toBe(true);
    });

    // **一般語は3枚のまま。**「winter の写真1枚」は世界中にある
    it.each(["tag", "category", "camera"] as const)("%s は3枚のまま", (type) => {
        expect(MIN_INDEXABLE_COUNT).toBe(3);
        expect(isIndexableCollection(2, type), "薄いページを量産する側に倒れている").toBe(false);
        expect(isIndexableCollection(3, type)).toBe(true);
    });

    it("0枚はどの種別でも載せない", () => {
        expect(isIndexableCollection(0, "location")).toBe(false);
    });
});
