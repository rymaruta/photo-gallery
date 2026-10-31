import { describe, it, expect } from "vitest";
import type { Spot } from "../../data/spots";
import { SPOTS } from "../../data/spots";
import { SUMMARY_MIN } from "../spotGuide";
import {
    buildSpotMatchIndex, spotMatcher, autoSpotIdFor, autoLinkTable, effectiveSpotId, photosLinkedTo,
    isRegionOnly, regionTokens, matchKey, SPOT_AUTO_KM,
} from "../spotAutoLink";
import PROD48 from "./spotAutoLink.prod48.json";

/**
 * **写真を撮影スポットに自動で結ぶ決まり**（2026-10-31 判断・journey.photo-ios#425）。
 *
 * 前半は本番の 48枚（2026-10-31 の `GET /photos`。題・説明・撮影地・位置だけを写した）と
 * 台帳（`content/spots.json`）で、案（https://claude.ai/artifact/NHrF23fezgz9sAE6qvS6xW の Summary）の
 * 表と同じ答えになることを縛る: 正しく16・誤り0・結べない2。台帳を直して答えが変わったら、
 * 案の表と見比べてからこの表を直す。
 */

const slugOf = new Map(SPOTS.map((s) => [s.spotId, s.slug]));
const matcher = spotMatcher(buildSpotMatchIndex(SPOTS));

/** 結ぶ 16枚（写真 id → 撮影スポットの slug） */
const LINKED: Array<[string, string]> = [
    ["5ba10f2b-cc93-567b-8671-929a2af681d3", "hirome"], // ひろめ市場
    ["2141ddff-965e-524a-aea5-fcdceeb7fe1b", "chateau-de-versailles"], // ヴェルサイユ宮殿（撮影地 ヴェルサイユ, Versailles…）
    ["ec059fb7-7727-516a-bfb6-fd64835d89ad", "miyagi-zao-fox"], // 夢の中 → 蔵王キツネ村（2.8km）
    ["318a2e96-4b89-5c79-b853-101da8c1fcca", "kobe-kitano-ijinkan"], // 神戸北野異人館街（撮影地 兵庫県神戸市・題で結ぶ）
    ["9bdb96d3-6761-50e7-a364-2945cae029c0", "takachiho-gorge"], // 高千穂峡（撮影地 宮崎県西臼杵郡・題で結ぶ）
    ["a129394d-f386-4795-9623-2d6e915d20c7", "lake-yamanaka"], // 白鳥と湖 → 山中湖
    ["88c66c1d-c2fc-4875-9b52-55756db18dbc", "lake-yamanaka"], // 木を覆う苔 → 山中湖
    ["edb09f51-c821-4ec4-8b84-6ea467d77131", "sagrada-familia"], // 未完の大聖堂（撮影地 バルセロナ・説明で結ぶ）
    ["a5951859-7334-43c6-9e6a-e65d8c6fe70f", "place-vendome"], // ヴァンドーム広場（撮影地 パリ＝地域なので距離を見ない）
    ["98846554-af2e-4e99-8da0-5edb06c1f430", "kamado-jinja"], // 森の呼吸 → 宝満宮 竈門神社
    ["ecb99a5f-ef3f-4951-bb4f-b255d36270d9", "chateau-de-versailles"], // ヴェルサイユ宮殿（撮影地 フランス ヴェルサイユ）
    ["e4e47af3-08e9-4791-8fd3-d8688a52d22c", "palais-garnier"], // オペラ・ガルニエ（パリ）
    ["a0e0e987-4686-437a-a5fd-b6eaa2debd84", "takaya-jinja"], // 天空の鳥居 → 高屋神社 本宮（3.7km）
    ["2354a297-a017-4001-afbf-70e9d9fa36f7", "helsinki-cathedral"], // ヘルシンキ大聖堂（撮影地も位置も無い）
    ["bb470019-c4a2-484e-bdbd-51e4b20fa4ef", "rovaniemi"], // 木こりのろうそく橋 → ロヴァニエミ
    ["29de9197-5d15-490e-83ae-491e7386bb34", "hitachi-seaside-park"], // 海 → 国営ひたち海浜公園
];

describe("本番の 48枚（案の表）", () => {
    it("48枚を写してある", () => {
        expect(PROD48).toHaveLength(48);
    });

    it("結ぶのは 16枚で、行き先も案の表のとおり（ほかの 32枚は結ばない）", () => {
        const got = Object.entries(autoLinkTable(matcher, PROD48))
            .map(([photo, spot]) => [photo, slugOf.get(spot)] as [string, string | undefined]);
        expect(new Map(got)).toEqual(new Map(LINKED));
    });

    // 案の表の「誤り・取りこぼしの例」。どれも決まりの1行が守っている
    const photo = (id: string) => PROD48.find((p) => p.id === id)!;
    it.each([
        ["a25d268e-1b5d-443a-8003-d7bcccb186bf", "題「リアス海岸」→ 横山展望台（別名は題・説明に当てない）"],
        ["b4f56c3f-b819-558a-9c79-8c433942bb90", "「道の駅 庄和」（撮影地 春日部市）→ 首都圏外郭放水路（地名だけの別名「春日部」）"],
        ["50b9f638-c86c-4df7-95ad-0bc2050ec535", "撮影地「東京」→ 東京国際フォーラム（距離だけでは結ばない）"],
        ["65300204-f4d3-4faf-9724-6cdd83bda35a", "撮影地「東京」の2枚目"],
        ["3b3ca482-2ac2-5a6b-a31c-0b2a60088262", "撮影地「中央区」→ 東京国際フォーラム"],
        ["c9a54af7-16fc-5bf1-9c3d-b7fc24a960ca", "撮影地「板橋区」"],
        ["18c7ad60-5600-4020-bbe0-edc84332e9ce", "撮影地「北海道」"],
        ["ab5e9442-d146-4eb4-9506-89cb8ed18daf", "「大阪府万博にて」（1970年か 2025年か決められない）"],
        ["c4e2dac4-b319-43f9-876a-395e9e7e9000", "題「大トリアノン宮殿」（取りこぼし: 別名なので題には当てない）"],
    ])("%s は結ばない: %s", (id) => {
        expect(matcher.match(photo(id))).toBeNull();
    });
});

describe("確かめで出た誤り（2026-10-31）", () => {
    const york = spot(12, { name: "ヨーク", region: { country: "イギリス", city: "ヨーク" }, coords: { lat: 53.96, lng: -1.08 } });

    it("撮影地「ニューヨーク」・NY の位置・題「ニューヨークの夜」→ ヨーク を結ばない", () => {
        expect(m([york]).match({ title: "ニューヨークの夜", location: "ニューヨーク", coords: { lat: 40.71, lng: -74.01 } })).toBeNull();
    });

    it("撮影地「リスボン, ポルトガル」・リスボンの位置・題「ポルトガルの夕日」→ ポルト を結ばない（本物の台帳）", () => {
        expect(matcher.match({ title: "ポルトガルの夕日", location: "リスボン, ポルトガル", coords: { lat: 38.72, lng: -9.14 } })).toBeNull();
    });

    it("撮影地「日本」・札幌の位置・題「東京タワー」→ 東京タワー を結ばない（本物の台帳）", () => {
        expect(matcher.match({ title: "東京タワー", location: "日本", coords: { lat: 43.06, lng: 141.35 } })).toBeNull();
        // 東京タワーの近くの本物の位置なら結ぶ（台帳に東京タワーがあることの確かめ）
        expect(slugOf.get(matcher.match({ title: "東京タワー", location: "日本", coords: { lat: 35.66, lng: 139.75 } }) ?? "")).toBe("tokyo-tower");
    });

    it("スマホカバー・ポルトガル旅行は結ばない（本物の台帳）", () => {
        expect(matcher.match({ title: "スマホカバーを新しくした" })).toBeNull();
        expect(matcher.match({ title: "ポルトガル旅行" })).toBeNull();
    });
});

describe("見直しで出た誤り（2026-10-31・2回目・本物の台帳）", () => {
    it.each([
        ["ニューヨーク市, アメリカ合衆国", "別名「ヨーク市」→ ヨーク"],
        ["New York, NY, USA", "別名「York」→ ヨーク"],
        ["Porto Alegre, Brasil", "別名「Porto」→ ポルト"],
        ["Toledo, Ohio, USA", "別名「Toledo」→ トレド"],
    ])("撮影地「%s」（位置なし）は結ばない: %s", (location) => {
        expect(matcher.match({ location })).toBeNull();
    });

    it("「札幌市」・地名から補った位置・題「東京タワーより高い」→ 東京タワー を結ばない", () => {
        expect(matcher.match({ title: "東京タワーより高い", location: "札幌市", coords: { lat: 43.06, lng: 141.35 }, geoApprox: true })).toBeNull();
    });

    it("「川崎市」・地名から補った位置・題「東京タワーが見えた」→ 東京タワー を結ばない（題だけの一致は代表点から 5km まで）", () => {
        expect(matcher.match({ title: "東京タワーが見えた", location: "川崎市", coords: { lat: 35.53, lng: 139.7 }, geoApprox: true })).toBeNull();
        // 撮影地の欄に名前があれば 50km のまま
        expect(slugOf.get(matcher.match({ location: "東京タワー", coords: { lat: 35.53, lng: 139.7 }, geoApprox: true }) ?? "")).toBe("tokyo-tower");
    });

    it("「リヨン, フランス」・地名から補った位置・題「ヴァンドーム広場を思い出す」→ ヴァンドーム広場 を結ばない", () => {
        expect(matcher.match({ title: "ヴァンドーム広場を思い出す", location: "リヨン, フランス", coords: { lat: 45.76, lng: 4.84 }, geoApprox: true })).toBeNull();
    });

    it("撮影地の1項目そのもの・語として書かれていれば結ぶ（ヨーク・ポルト・パリの代表点）", () => {
        expect(matcher.match({ location: "ヨーク, イギリス" })).toMatch(/^sp_/);
        expect(slugOf.get(matcher.match({ location: "ポルト, ポルトガル" }) ?? "")).toBe("porto");
        expect(slugOf.get(matcher.match({ title: "ヴァンドーム広場", location: "パリ", coords: { lat: 48.86, lng: 2.32 }, geoApprox: true }) ?? "")).toBe("place-vendome");
    });
});

describe("地名だけの別名（台帳の全行の地域から決める）", () => {
    const regions = regionTokens(SPOTS);

    it.each(["春日部", "兵庫県神戸市", "バルセロナ", "フランス ヴェルサイユ", "宮崎県西臼杵郡", "屋久島", "平泉", "立山", "志摩"])(
        "「%s」は地域の名前だけでできている", (alias) => {
            expect(isRegionOnly(matchKey(alias), regions)).toBe(true);
        });

    it.each(["首都圏外郭放水路", "蔵王キツネ村", "宮城蔵王キツネ村", "サグラダ・ファミリア", "リアス海岸"])(
        "「%s」は地域ではない", (name) => {
            expect(isRegionOnly(matchKey(name), regions)).toBe(false);
        });

    it("索引の別名に、地名だけのものは残らない", () => {
        const index = buildSpotMatchIndex(SPOTS);
        const left = index.spots.flatMap((r) => r.a ?? []).filter((a) => isRegionOnly(a, regions));
        expect(left).toEqual([]);
    });
});

// ── 決まりの1行ずつ（作った台帳で） ─────────────────────────

function spot(id: number, over: Partial<Spot> = {}): Spot {
    return {
        spotId: `sp_${String(id).padStart(12, "0")}`,
        slug: `spot-${id}`,
        name: `撮影スポット${id}`,
        summary: "あ".repeat(SUMMARY_MIN),
        region: { country: "日本", prefecture: "宮城県", city: "白石市" },
        coords: { lat: 38.02, lng: 140.55 },
        highlights: ["見どころ"],
        officialWebsiteUrl: "https://example.example/",
        status: "published",
        verifiedBy: "運営",
        verifiedAt: "2026-10-31",
        createdAt: "2026-10-31T00:00:00.000Z",
        updatedAt: "2026-10-31T00:00:00.000Z",
        ...over,
    };
}

const FOX = spot(1, { name: "蔵王キツネ村", aliases: ["宮城蔵王キツネ村", "白石市", "リアス海岸"] });
const m = (spots: Spot[]) => spotMatcher(buildSpotMatchIndex(spots));
/** 北へ km だけずらした位置（緯度 1度 ≒ 111.2km） */
const north = (km: number) => ({ lat: 38.02 + km / 111.195, lng: 140.55 });

describe("決まり", () => {
    it("正式名が撮影地・題・説明のどれかにあれば結ぶ", () => {
        const mm = m([FOX]);
        expect(mm.match({ location: "蔵王キツネ村, 白石市" })).toBe(FOX.spotId);
        expect(mm.match({ title: "蔵王キツネ村で" })).toBe(FOX.spotId);
        expect(mm.match({ title: { ja: "夢の中" }, description: { ja: ["蔵王キツネ村での一枚"] } })).toBe(FOX.spotId);
    });

    it("正式名は括弧の中を除いて比べ、3字未満の名前は使わない", () => {
        const garnier = spot(2, { name: "オペラ・ガルニエ（パレ・ガルニエ）", region: { country: "フランス", city: "パリ" }, coords: { lat: 48.87, lng: 2.33 } });
        const short = spot(3, { name: "大山" });
        const mm = m([garnier, short]);
        expect(mm.match({ location: "オペラ・ガルニエ（パリ）" })).toBe(garnier.spotId);
        expect(mm.match({ title: "大山の夕景" })).toBeNull();
    });

    it("別名は撮影地の文字にあるときだけ（題・説明には当てない）", () => {
        const mm = m([FOX]);
        expect(mm.match({ location: "宮城蔵王キツネ村" })).toBe(FOX.spotId);
        expect(mm.match({ title: "リアス海岸" })).toBeNull();
        expect(mm.match({ location: "リアス海岸" })).toBe(FOX.spotId);
    });

    it("地名だけの別名は使わない（撮影地「白石市」で結ばない）", () => {
        expect(m([FOX]).match({ location: "白石市, 宮城県" })).toBeNull();
    });

    it(`位置が両方あれば ${SPOT_AUTO_KM}km 以内だけ`, () => {
        const mm = m([FOX]);
        expect(mm.match({ title: "蔵王キツネ村", coords: north(4.9) })).toBe(FOX.spotId);
        expect(mm.match({ title: "蔵王キツネ村", coords: north(5.5) })).toBeNull();
    });

    it("距離を省くのは、写真の位置が地名から補ったもの（geoApprox）のときだけ", () => {
        const vendome = spot(4, { name: "ヴァンドーム広場", region: { country: "フランス", city: "パリ" }, coords: { lat: 48.87, lng: 2.33 } });
        const mm = m([vendome]);
        // 地名「パリ」から補った代表点でも、題だけの一致は 5km まで（2026-10-31 判断・最後の見直し）
        expect(mm.match({ title: "ヴァンドーム広場", location: "パリ", coords: { lat: 48.86, lng: 2.32 }, geoApprox: true })).toBe(vendome.spotId);
        expect(mm.match({ title: "ヴァンドーム広場", location: "パリ", coords: { lat: 49.05, lng: 2.33 }, geoApprox: true })).toBeNull();
        // 撮影地の欄に名前があれば、補った位置は 50km まで見る
        expect(mm.match({ location: "ヴァンドーム広場, パリ", coords: { lat: 49.05, lng: 2.33 }, geoApprox: true })).toBe(vendome.spotId);
        // 本物の位置なら、撮影地が地域の名前だけでも 5km を見る（2026-10-31 確かめの指摘）
        expect(mm.match({ title: "ヴァンドーム広場", location: "パリ", coords: { lat: 49.05, lng: 2.33 } })).toBeNull();
        expect(mm.match({ title: "ヴァンドーム広場", location: "ホテル前", coords: { lat: 49.05, lng: 2.33 } })).toBeNull();
    });

    it("語の切れ目は正規化の前の文字で見る（中黒・空白の後ろは切れ目・カタカナの続きは切れ目ではない）", () => {
        const vendome = spot(13, { name: "ヴァンドーム広場", aliases: ["Place Vendome"], region: { country: "フランス", city: "パリ" }, coords: { lat: 48.87, lng: 2.33 } });
        const mm = m([vendome]);
        expect(mm.match({ title: "パリ・ヴァンドーム広場にて" })).toBe(vendome.spotId);
        expect(mm.match({ location: "Place Vendôme, Paris" })).toBeNull(); // ô は別の字（台帳の綴りどおりでないと当てない）
        expect(mm.match({ location: "Place Vendome, Paris" })).toBe(vendome.spotId);
        expect(mm.match({ location: "Place Vendomex, Paris" })).toBeNull();
        expect(mm.match({ title: "ニューヴァンドーム広場" })).toBeNull();
    });

    it("英字だけの5字以下の名前・別名は、撮影地の1項目と丸ごと同じときだけ（語の切れ目だけでは当てない）", () => {
        const bikan = spot(14, { name: "倉敷美観地区", aliases: ["Bikan"], region: { country: "日本", prefecture: "岡山県", city: "倉敷市" }, coords: { lat: 34.6, lng: 133.77 } });
        const mm = m([bikan]);
        expect(mm.match({ location: "Bikan Street Cafe, Tokyo" })).toBeNull();
        expect(mm.match({ location: "Bikan, Kurashiki" })).toBe(bikan.spotId);
    });

    it("補った位置のときは、位置が無いときと同じく県の食い違いを見る", () => {
        expect(m([FOX]).match({ title: "蔵王キツネ村", location: "山形県", coords: { lat: 38.02, lng: 140.55 }, geoApprox: true })).toBeNull();
    });

    it("短いカタカナの名前・別名は、撮影地の1項目と丸ごと同じときだけ（題・説明の部分一致には使わない）", () => {
        const cover = spot(9, { name: "カバー", region: { country: "日本", prefecture: "東京都" }, coords: { lat: 35.68, lng: 139.76 } });
        const porto = spot(10, { name: "ポルト", region: { country: "ポルトガル", city: "ポルト" }, coords: { lat: 41.15, lng: -8.61 } });
        const ginza = spot(11, { name: "銀座の通り", aliases: ["ギンザ"], region: { country: "日本", prefecture: "東京都" }, coords: { lat: 35.67, lng: 139.77 } });
        const mm = m([cover, porto, ginza]);
        expect(mm.match({ title: "スマホカバーを新しくした" })).toBeNull();
        expect(mm.match({ title: "ポルトガル旅行" })).toBeNull();
        expect(mm.match({ location: "ポルトガル" })).toBeNull();
        expect(mm.match({ title: "ポルトの朝" })).toBeNull();
        expect(mm.match({ location: "ポルト, ポルトガル" })).toBe(porto.spotId);
        expect(mm.match({ location: "ギンザ、東京" })).toBe(ginza.spotId);
        expect(mm.match({ location: "ギンザ通り" })).toBeNull();
    });

    it("写真に位置が無いときは、撮影地の県が食い違わないこと", () => {
        const mm = m([FOX]);
        expect(mm.match({ title: "蔵王キツネ村", location: "宮城県" })).toBe(FOX.spotId);
        expect(mm.match({ title: "蔵王キツネ村", location: "山形県" })).toBeNull();
        expect(mm.match({ title: "蔵王キツネ村" })).toBe(FOX.spotId);
    });

    it("当たる撮影スポットが2つ以上なら結ばない", () => {
        const other = spot(5, { name: "白石城" });
        expect(m([FOX, other]).match({ title: "蔵王キツネ村から白石城へ" })).toBeNull();
    });

    it("台帳で2件以上に当たる名前・別名は使わない（同名異所）", () => {
        const a = spot(6, { name: "八幡神社" });
        const b = spot(7, { name: "八幡神社", region: { country: "日本", prefecture: "京都府" }, coords: { lat: 35.0, lng: 135.7 } });
        const c = spot(8, { name: "別の神社", aliases: ["蔵王キツネ村"] });
        expect(m([a, b]).match({ title: "八幡神社" })).toBeNull();
        expect(m([FOX, c]).match({ location: "蔵王キツネ村" })).toBeNull();
    });

    it("公開済みの撮影スポットだけ（運営の下書きには結ばない）", () => {
        expect(m([{ ...FOX, status: "review" }]).match({ title: "蔵王キツネ村" })).toBeNull();
    });

    it("本人が選んだ spotId が先・本人が外した写真は結ばない", () => {
        const mm = m([FOX]);
        expect(autoSpotIdFor(mm, { title: "蔵王キツネ村" })).toBe(FOX.spotId);
        expect(autoSpotIdFor(mm, { title: "蔵王キツネ村", spotId: "sp_aaaaaaaaaaaa" })).toBeNull();
        expect(autoSpotIdFor(mm, { title: "蔵王キツネ村", spotAuto: "off" })).toBeNull();
        expect(effectiveSpotId({ id: "p1", spotId: "sp_aaaaaaaaaaaa" }, { p1: FOX.spotId })).toBe("sp_aaaaaaaaaaaa");
        expect(effectiveSpotId({ id: "p1" }, { p1: FOX.spotId })).toBe(FOX.spotId);
        expect(effectiveSpotId({ id: "p2" }, { p1: FOX.spotId })).toBeUndefined();
    });

    it("表は自動の結びだけ・公開の写真だけ・id の順", () => {
        const table = autoLinkTable(m([FOX]), [
            { id: "b", title: "蔵王キツネ村" },
            { id: "a", title: "蔵王キツネ村" },
            { id: "c", title: "蔵王キツネ村", published: false },
            { id: "d", title: "蔵王キツネ村", spotId: "sp_aaaaaaaaaaaa" },
            { id: "e", title: "蔵王キツネ村", spotAuto: "off" },
        ]);
        expect(JSON.stringify(table)).toBe(JSON.stringify({ a: FOX.spotId, b: FOX.spotId }));
    });

    it("撮影スポットの写真は spotId と自動の結びの両方（非公開は出さない）", () => {
        const photos = [
            { id: "a", spotId: FOX.spotId },
            { id: "b" },
            { id: "c", published: false },
            { id: "d", spotId: "sp_aaaaaaaaaaaa" },
        ];
        const table = { b: FOX.spotId, c: FOX.spotId, d: FOX.spotId };
        const got = photosLinkedTo(photos, FOX.spotId, table);
        expect(got.photos.map((p) => p.id)).toEqual(["a", "b"]);
        expect(got.hasAuto).toBe(true);
        expect(photosLinkedTo(photos, FOX.spotId, {}).hasAuto).toBe(false);
    });

    it("索引は JSON を通しても同じ答え（投稿画面は `/app/data/spot-match.json` を読む）", () => {
        const index = buildSpotMatchIndex(SPOTS);
        const viaJson = spotMatcher(JSON.parse(JSON.stringify(index)));
        for (const p of PROD48) expect(viaJson.match(p)).toBe(matcher.match(p));
    });
});
