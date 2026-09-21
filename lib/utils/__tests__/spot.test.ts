import { describe, it, expect } from "vitest";
import {
    broaderSpots,
    narrowerSpots,
    spotCoords,
    nearbySpots,
    spotFacts,
    spotDetail,
} from "../spot";
import { collectEntries } from "../collections";
import type { Photo } from "../../data/photos";
import realPhotos from "../../../app/data/photos.json";

const P = (id: string, extra: Partial<Photo> = {}): Photo =>
    ({ id, src: `https://cdn/${id}.jpg`, ...extra }) as Photo;

describe("広い／細かい撮影地（既にある向きのある一致をそのまま使う）", () => {
    const entries = collectEntries([
        P("1", { location: "フランス" }),
        P("2", { location: "パリ" }),
        P("3", { location: "オペラ・ガルニエ（パリ）" }),
        P("4", { location: "山中湖" }),
    ], "location");

    it("広い方を拾う（写真の撮影地が、その見出しのページに載る向き）", () => {
        expect(broaderSpots("オペラ・ガルニエ（パリ）", entries).map((e) => e.label)).toEqual(["パリ"]);
    });

    it("細かい方はその逆向き", () => {
        expect(narrowerSpots("パリ", entries).map((e) => e.label)).toEqual(["オペラ・ガルニエ（パリ）"]);
    });

    // **対称にしない。** 対称にすると「パリ」のページが
    // 「オペラ・ガルニエ（パリ）」を広い方として出す（逆さま）
    it("向きを逆にしたものは拾わない", () => {
        expect(broaderSpots("パリ", entries).map((e) => e.label)).not.toContain("オペラ・ガルニエ（パリ）");
        expect(narrowerSpots("オペラ・ガルニエ（パリ）", entries).map((e) => e.label)).toEqual([]);
    });

    it("関係の無い撮影地は出ない", () => {
        expect(broaderSpots("山中湖", entries)).toEqual([]);
        expect(narrowerSpots("山中湖", entries)).toEqual([]);
    });

    it("自分自身は出ない", () => {
        expect(broaderSpots("パリ", entries).map((e) => e.label)).not.toContain("パリ");
    });

    /**
     * **「どちらが広いか」を字の長さで決めない——そもそも決められない。**
     *
     * 一度「名前が短い方が広い」で並べたが**逆になった**：
     * `/location/パリ,-フランス` の広い方は「パリ」(2文字) と
     * 「フランス」(4文字) で、短いのは**狭い方の「パリ」**。
     *
     * では包含で決められるかというと**決められない**。`photoIsInLocation` は
     * 字の包含なので `"パリ"` と `"フランス"` は**どちらも相手を含まない**
     * ——このデータは「フランスの方が広い」を知らない。知らないものを
     * 順番で主張しないので、決まらない組は枚数の多い順 → slug 順にする。
     */
    it("入れ子でない組は「どちらが広いか」を主張しない（枚数順→slug順）", () => {
        const e2 = collectEntries([
            P("1", { location: "フランス" }),
            P("2", { location: "パリ" }),
            P("3", { location: "パリ, フランス" }),
        ], "location");
        // パリ・フランスとも2枚で同数 → slug 順。**字の長さでは決まっていない**
        expect(broaderSpots("パリ, フランス", e2).map((x) => x.label)).toEqual(["パリ", "フランス"]);
    });

    /** 入れ子になっている組だけは、包含で決まるので決める（広い方が先） */
    it("入れ子の組は広い方を先に出す", () => {
        const e3 = collectEntries([
            P("1", { location: "フランス" }),
            P("2", { location: "パリ, フランス" }),
            P("3", { location: "オペラ・ガルニエ（パリ, フランス）" }),
        ], "location");
        // 「オペラ…（パリ, フランス）」は「パリ, フランス」にも「フランス」にも含まれ、
        // かつ「パリ, フランス」は「フランス」に含まれる＝順が決まる
        expect(broaderSpots("オペラ・ガルニエ（パリ, フランス）", e3).map((x) => x.label))
            .toEqual(["フランス", "パリ, フランス"]);
    });
});

describe("代表座標", () => {
    it("座標が無ければ null", () => {
        expect(spotCoords([P("1", { location: "パリ" })])).toBeNull();
    });

    // **正確な GPS と、地名から引いた推定を混ぜない。**
    // 混ぜると「約1kmに丸めた GPS」と「街の中心」が平均され、
    // どちらでもない点ができる
    it("正確な座標が1枚でもあれば、推定は混ぜない", () => {
        const got = spotCoords([
            P("1", { coords: { lat: 48.86, lng: 2.34 } }),
            P("2", { coords: { lat: 40.0, lng: 100.0 }, geoApprox: true }),
        ]);
        expect(got).toEqual({ lat: 48.86, lng: 2.34, approx: false });
    });

    it("推定しか無ければ推定として返す", () => {
        const got = spotCoords([P("1", { coords: { lat: 48.86, lng: 2.34 }, geoApprox: true })]);
        expect(got).toEqual({ lat: 48.86, lng: 2.34, approx: true });
    });

    /**
     * **有限の数であることまで見る**（`PhotoMap` が同じデータに同じ判定を
     * 掛けている）。NaN が1件混ざると、地図タブが「位置がありません」では
     * なく座標ありの文面を出し、周辺のスポットに `NaNkm` が**静的HTMLへ
     * 焼き込まれる**（直すには再ビルドが要る）。
     */
    it("NaN / Infinity の座標は無いものとして扱う", () => {
        expect(spotCoords([P("1", { coords: { lat: NaN, lng: 2.3 } })])).toBeNull();
        expect(spotCoords([P("1", { coords: { lat: 48.8, lng: Infinity } })])).toBeNull();
        // 壊れた1枚が混ざっても、残りから出せる
        expect(spotCoords([
            P("1", { coords: { lat: NaN, lng: NaN } }),
            P("2", { coords: { lat: 48.86, lng: 2.34 } }),
        ])).toEqual({ lat: 48.86, lng: 2.34, approx: false });
    });

    // **平均ではなく中央値。** 平均は外れ値1枚に引きずられて、
    // どの写真の場所でもない点になる
    it("外れ値1枚に引きずられない（中央値）", () => {
        const got = spotCoords([
            P("1", { coords: { lat: 35.0, lng: 139.0 } }),
            P("2", { coords: { lat: 35.1, lng: 139.1 } }),
            P("3", { coords: { lat: 80.0, lng: 10.0 } }),
        ]);
        expect(got).toMatchObject({ lat: 35.1, lng: 139.0 });
    });
});

describe("周辺のスポット（距離順）", () => {
    const e = (slug: string, count = 1) => ({ slug, label: slug, count });
    const at = (lat: number, lng: number, approx = false) => ({ lat, lng, approx });

    it("近い順に並ぶ", () => {
        const got = nearbySpots(at(35.0, 139.0), [
            { entry: e("遠い"), coords: at(36.0, 139.0) },
            { entry: e("近い"), coords: at(35.05, 139.0) },
        ]);
        expect(got.map((x) => x.slug)).toEqual(["近い", "遠い"]);
        expect(got[0].km).toBeLessThan(got[1].km);
    });

    // **距離を知らないものを「近い順」に混ぜない**
    it("座標を持たない相手は出さない", () => {
        const got = nearbySpots(at(35.0, 139.0), [
            { entry: e("座標なし"), coords: null },
            { entry: e("あり"), coords: at(35.1, 139.0) },
        ]);
        expect(got.map((x) => x.slug)).toEqual(["あり"]);
    });

    it("自分に座標が無ければ1件も出さない", () => {
        expect(nearbySpots(null, [{ entry: e("あり"), coords: at(35.1, 139.0) }])).toEqual([]);
    });

    // `geoApprox` を正確な GPS と区別する。どちらか一方でも推定なら、
    // その距離は推定（画面が断りを書けるようにする）
    it("片方でも推定なら、その距離は推定の印が付く", () => {
        const got = nearbySpots(at(35.0, 139.0), [
            { entry: e("推定の相手"), coords: at(35.1, 139.0, true) },
        ]);
        expect(got[0].approx).toBe(true);
        const got2 = nearbySpots(at(35.0, 139.0, true), [
            { entry: e("正確な相手"), coords: at(35.1, 139.0) },
        ]);
        expect(got2[0].approx).toBe(true);
    });

    it("上限で切る", () => {
        const others = Array.from({ length: 20 }, (_, i) => ({
            entry: e(`s${i}`), coords: at(35 + i * 0.01, 139),
        }));
        expect(nearbySpots(at(35, 139), others, 3)).toHaveLength(3);
    });
});

describe("概要（持っているデータだけ）", () => {
    const photos = [
        P("1", { userId: "u1", date: "2024-10-12", exif: { camera: "SONY ILCE-7M3" }, tags: ["winter", "自然"] }),
        P("2", { userId: "u1", date: "2023-05-01", exif: { camera: "SONY ILCE-7M3" }, tags: ["winter"] }),
        P("3", { userId: "u2", exif: { camera: "Hasselblad Hasselblad X2D II 100C" } }),
    ];

    it("枚数と撮った人の数を数える", () => {
        const f = spotFacts(photos);
        expect(f.photoCount).toBe(3);
        expect(f.photographerCount).toBe(2);
    });

    it("非公開は数えない", () => {
        expect(spotFacts([...photos, P("4", { published: false, userId: "u9" })]).photoCount).toBe(3);
    });

    // **`createdAt`（投稿日）を撮影期間として出さない。** 実データは
    // 30枚中8枚しか撮影日を持たず、残りはアップロードした年に固まっている
    it("撮影期間は `date` だけから出す（`createdAt` は使わない）", () => {
        expect(spotFacts(photos).period).toEqual({ from: "2023-05-01", to: "2024-10-12" });
        const noDate = spotFacts([P("9", { createdAt: "2026-01-01T00:00:00Z" })]);
        expect(noDate.period).toBeNull();
    });

    // **`dedupeCameraName` を通す。** 通さないと同じ機種が2つに割れる
    // （保存済みの値に二重のメーカー名が残っている）
    it("カメラ名の二重のメーカー名を畳む", () => {
        expect(spotFacts(photos).cameras.map((c) => c.name)).toEqual([
            "SONY ILCE-7M3", "Hasselblad X2D II 100C",
        ]);
    });

    it("タグは畳んだ鍵で数え、出すのは生の表記", () => {
        const f = spotFacts(photos);
        expect(f.tags.find((t) => t.slug === "winter")?.count).toBe(2);
        // `自然` は `CATEGORY_ALIASES` で `nature` に寄るが、見出しは打たれた字
        expect(f.tags.find((t) => t.slug === "nature")?.label).toBe("自然");
    });

    // 1枚の中で同じタグを2通り書いても、枚数は1
    it("同じ写真の中の重複は1枚として数える", () => {
        const f = spotFacts([P("1", { tags: ["自然", "nature"] })]);
        expect(f.tags.find((t) => t.slug === "nature")?.count).toBe(1);
    });
});

/**
 * **実データで確かめる。**
 *
 * 台帳が繰り返し書いている通り、撮影地は自前の集計ではなく
 * リポジトリ本体の関数を通さないと結論を誤る。ここは
 * `app/data/photos.json`（公開30枚・撮影地が入っているのは17枚）で
 * **いま何が出るか**を固定する。
 */
describe("実データ（app/data/photos.json）", () => {
    const photos = realPhotos as unknown as Photo[];

    /**
     * **実測した包含の組は4つだけ**（本体の関数で数えた）:
     *
     *     フランス ヴェルサイユ        → フランス
     *     オペラ・ガルニエ（パリ）      → パリ
     *     パリ, フランス               → フランス
     *     パリ, フランス               → パリ
     *
     * **「パリ」は「フランス」を広い方として持たない**——`photoIsInLocation`
     * は文字列の包含で見るので、`"パリ"` は `"フランス"` を含まない。
     * ここを「持つはず」と書いた最初のテストは**実装ではなくテストの方が
     * 間違っていた**。地名の上下関係を当てに行く仕組みは**持っていない**
     * ので、書かれた字から読み取れるぶんだけを出す。
     */
    it("実測した包含の組をそのまま出す（地名の上下関係を当てに行かない）", () => {
        const entries = collectEntries(photos, "location");
        expect(broaderSpots("パリ, フランス", entries).map((e) => e.label).sort())
            .toEqual(["パリ", "フランス"]);
        expect(narrowerSpots("パリ", entries).map((e) => e.label).sort())
            .toEqual(["オペラ・ガルニエ（パリ）", "パリ, フランス"]);
        // 「パリ」単体は、字の上で「フランス」を含まない
        expect(broaderSpots("パリ", entries)).toEqual([]);
    });

    /**
     * **コミット済みの断面には座標が1件も無い。**
     *
     * 本番では `scripts/geocode-locations.js` が地名から引いた
     * `geoApprox` の座標を入れているので周辺のスポットが出るが、
     * **手元のビルドでは出ない**。出ない状態を「壊れている」と
     * 読まないための固定で、**座標が入った日にここが落ちる**
     * ——落ちたら、この期待を消して画面側の確認に進んでよい。
     */
    it("座標を持つ写真は0枚なので、周辺のスポットは出ない", () => {
        expect(photos.filter((p) => p.coords).length).toBe(0);
        const detail = spotDetail(photos, "パリ", photos.filter((p) => p.location === "パリ"));
        expect(detail.coords).toBeNull();
        expect(detail.nearby).toEqual([]);
    });

    /**
     * **自分に座標が無ければ、相手の座標も引かない。**
     *
     * `nearbySpots` は `!here` で即 `[]` を返すので、組み立ては丸ごと無駄。
     * しかもその組み立ては**撮影地の数 × 全写真**の `photoIsInLocation` で、
     * 静的書き出しは全撮影地ページでこれを回す（O(撮影地² × 写真)）。
     * コミット済みの断面は座標0件＝**全ページがこの経路**。
     */
    it("座標が無いときは、他の撮影地の座標を引きに行かない", () => {
        let reads = 0;
        // `coords` を読みに来た回数を数える（引きに行っていれば増える）
        const watched = photos.map((p) => {
            const clone = { ...p } as Photo;
            Object.defineProperty(clone, "coords", {
                get() { reads++; return undefined; },
                enumerable: true,
            });
            return clone;
        });
        const matched = watched.filter((p) => (p.location ?? "").includes("パリ"));
        const before = reads;
        const detail = spotDetail(watched, "パリ", matched);
        expect(detail.nearby).toEqual([]);
        // 見るのは自分のぶん（`matched`）だけ。全撮影地ぶんは回さない
        expect(reads - before).toBeLessThanOrEqual(matched.length * 2);
    });

    it("スポット詳細の材料が、集約ページの枚数と食い違わない", () => {
        const entries = collectEntries(photos, "location");
        const paris = entries.find((e) => e.label === "パリ")!;
        // `/location/パリ` に載るのは「パリ」を含む撮影地の写真（向きあり）
        const matched = photos.filter((p) => (p.location ?? "").includes("パリ"));
        expect(spotDetail(photos, "パリ", matched).facts.photoCount).toBe(paris.count);
    });
});
