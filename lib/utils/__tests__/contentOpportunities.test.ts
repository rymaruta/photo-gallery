import { describe, it, expect } from "vitest";
import { contentOpportunities } from "../contentOpportunities";
import { MIN_INDEXABLE_COUNT, MIN_INDEXABLE_LOCATION } from "../collections";
import type { Photo } from "../../data/photos";

/**
 * **「あと1枚」を数える道具。**
 *
 * 検索での面積はサイトマップの件数そのもので、増やす道は集約ページを
 * 線の上に押し上げること。線は種別で違う（タグ・カテゴリ・機材は3枚、
 * **撮影地だけ2枚**）。
 *
 * **手で数えない**——撮影地は `photosInCollection` が緩い一致で束ねるので、
 * 完全一致で数えると「全部 noindex」に見えて結論を誤る（台帳に実例）。
 * だから本体の関数（`collectEntries` / `isIndexableCollection`）を通す。
 */
const P = (id: string, o: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn/${id}.jpg`, userId: "u", published: true, tags: [], ...o,
} as Photo);

describe("あと1枚で検索に載るページ", () => {
    it("線に1枚足りないページだけを挙げる", () => {
        const photos = [
            // タグ: 線は3枚。2枚 → あと1枚
            P("a", { tags: ["forest"] }), P("b", { tags: ["forest"] }),
            // タグ: 1枚 → あと2枚なので挙げない
            P("c", { tags: ["苔"] }),
            // タグ: 3枚 → もう載っている
            P("d", { tags: ["lake"] }), P("e", { tags: ["lake"] }), P("f", { tags: ["lake"] }),
        ];
        const r = contentOpportunities(photos);
        const tags = r.almost.filter((o) => o.type === "tag").map((o) => o.label);
        expect(tags, "あと2枚のページや、もう載っているページが混ざっている").toEqual(["forest"]);
    });

    // **撮影地だけ線が違う**（2枚）。ここを取り違えると結論が丸ごとずれる
    it("撮影地の線は2枚（1枚のページが「あと1枚」）", () => {
        const r = contentOpportunities([P("a", { location: "パリ" })]);
        const loc = r.almost.filter((o) => o.type === "location");
        expect(MIN_INDEXABLE_LOCATION, "前提が変わった").toBe(2);
        expect(MIN_INDEXABLE_COUNT, "前提が変わった").toBe(3);
        expect(loc.map((o) => o.label)).toEqual(["パリ"]);
        expect(loc[0].count).toBe(1);
    });

    // 撮影地が先（線が2枚＝いちばん安い）、次は枚数の多い順
    it("効く順に並べる（撮影地が先・枚数の多い順）", () => {
        const photos = [
            P("a", { location: "パリ" }),
            P("b", { tags: ["forest"] }), P("c", { tags: ["forest"] }),
            P("d", { category: "街" }), P("e", { category: "街" }),
        ];
        const r = contentOpportunities(photos);
        expect(r.almost[0].type, "撮影地を先に出していない").toBe("location");
        expect(r.almost.every((o) => o.need === 1)).toBe(true);
    });

    it("非公開・ストーリーは数えない", () => {
        const photos = [
            P("a", { tags: ["forest"] }), P("b", { tags: ["forest"] }),
            P("c", { tags: ["forest"], published: false }),
            P("d", { tags: ["forest"], story: true } as Partial<Photo>),
        ];
        const r = contentOpportunities(photos);
        expect(r.published, "非公開やストーリーを数えている").toBe(2);
        expect(r.almost.filter((o) => o.type === "tag").map((o) => o.count)).toEqual([2]);
    });

    it("写真の側の材料も数える", () => {
        const photos = [
            P("a", { location: "パリ", description: { ja: ["あ".repeat(120)] } } as Partial<Photo>),
            P("b", { description: { ja: ["短い"] } } as Partial<Photo>),
            P("c", {}),
        ];
        const r = contentOpportunities(photos);
        expect(r.photosWithoutLocation, "撮影地が空の数が違う").toBe(2);
        expect(r.photosWithShortDescription, "説明が短い数が違う").toBe(2);
    });

    it("何も無ければ空（数え上げが空回りしない）", () => {
        const r = contentOpportunities([]);
        expect(r.almost).toEqual([]);
        expect(r.published).toBe(0);
        expect(r.total.tag).toBe(0);
    });
});
