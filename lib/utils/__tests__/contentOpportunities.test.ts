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

/**
 * **撮影地が空の写真は、行き先を自分のタグに書いていることが多い。**
 *
 * 実データ（公開30枚）で数えると撮影地が空なのは13枚で、**そのうち12枚が
 * `finland` を持つ**——1回の旅ぶん。数だけ出しても「13枚ある」で終わるので、
 * 同じタグを共有する塊にして並べる。
 *
 * **地名の表は持たない。** どのタグが地名かは機械が決めない（表は owner が
 * 育てないぶん静かに古くなる＝一度断られている形）。並べるだけ。
 */
describe("撮影地が空の写真を、共有タグでまとめる", () => {
    it("いちばん多くを覆うタグから塊にする", () => {
        const photos = [
            P("a", { tags: ["finland", "sauna"] }),
            P("b", { tags: ["finland", "forest"] }),
            P("c", { tags: ["finland"] }),
            P("d", { tags: ["paris", "opera"] }),
            P("e", { tags: ["paris"] }),
            P("f", { location: "東京", tags: ["finland"] }),
        ];
        const g = contentOpportunities(photos).missingLocation;
        expect(g.map((x) => [x.sharedTag, x.photos.map((p) => p.id)]))
            .toEqual([["finland", ["a", "b", "c"]], ["paris", ["d", "e"]]]);
    });

    it("2枚以上を覆うタグだけが塊になる（1枚ずつに割らない）", () => {
        const photos = [P("a", { tags: ["x"] }), P("b", { tags: ["y"] })];
        const g = contentOpportunities(photos).missingLocation;
        expect(g.map((x) => x.sharedTag), "1枚しか覆わないタグで括っている").toEqual([""]);
        expect(g[0].photos.map((p) => p.id)).toEqual(["a", "b"]);
    });

    it("塊に入らなかったものは最後にまとめる", () => {
        const photos = [
            P("a", { tags: ["finland"] }), P("b", { tags: ["finland"] }),
            P("c", { tags: ["紫陽花"] }),
        ];
        const g = contentOpportunities(photos).missingLocation;
        expect(g.map((x) => x.sharedTag)).toEqual(["finland", ""]);
        expect(g[1].photos.map((p) => p.id)).toEqual(["c"]);
    });

    // **タグは畳んでから数える。** `#finland` と `Finland` を別物として数えると
    // 塊が割れて「1枚ずつ」に戻る（`slugify(_, "tag")` が畳む規則）
    it("大小・# の違いは同じタグとして束ねる", () => {
        const photos = [
            P("a", { tags: ["Finland"] }), P("b", { tags: ["#finland"] }), P("c", { tags: ["finland"] }),
        ];
        const g = contentOpportunities(photos).missingLocation;
        expect(g.length, "同じタグが別物として割れている").toBe(1);
        expect(g[0].photos.map((p) => p.id)).toEqual(["a", "b", "c"]);
    });

    it("1枚の中の重複タグは1回だけ出す", () => {
        const photos = [P("a", { tags: ["finland", "#Finland", "", "  "] }), P("b", { tags: ["finland"] })];
        const g = contentOpportunities(photos).missingLocation;
        expect(g[0].photos[0].tags, "同じタグや空を並べている").toEqual(["finland"]);
    });

    it("題は日本語で出す（無題も潰さない）", () => {
        const photos = [
            P("a", { tags: ["t"], title: { ja: "北欧の森", en: "Nordic forest" } } as Partial<Photo>),
            P("b", { tags: ["t"] }),
        ];
        const g = contentOpportunities(photos).missingLocation;
        expect(g[0].photos.map((p) => p.title)).toEqual(["北欧の森", ""]);
    });

    it("撮影地がある写真は出さない", () => {
        const photos = [P("a", { location: "パリ", tags: ["x"] }), P("b", { location: "  ", tags: ["x"] })];
        const g = contentOpportunities(photos).missingLocation;
        expect(g.map((x) => x.photos.map((p) => p.id))).toEqual([["b"]]);
    });

    it("全部に撮影地があれば空", () => {
        expect(contentOpportunities([P("a", { location: "パリ" })]).missingLocation).toEqual([]);
    });
});
