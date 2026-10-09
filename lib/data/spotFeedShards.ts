// lib/data/spotFeedShards.ts（サーバー専用）
//
// **撮影スポットを数千〜数万件に増やすための、分けた置き場**（2026-10-07）。
// 設計は `docs/spot-feed-sharding.md`。
//
//   /app/data/spot-feed/index.json   軽い索引（全件）。地図のピン・名前で探す・季節/時間帯で絞る・
//                                    ホームの段・近くの撮影地の候補に要る最小限だけ
//   /app/data/spot-feed/<区分>.json  区分ごとの詳細。**行は `spots.json` の行と同じ中身**
//                                    （`toSpotFeedItem`）——写真・概要・季節/時間帯の文・時刻帯
//
// 区分の鍵（`shardKey`）は**アプリにとって意味の無い札**として扱わせる（アプリは索引の
// `shards[].key` と、その下の行だけを見る）。区分が大きくなったら、アプリを変えずに
// サーバーだけで割り直せる（例: `jp-kanto` → 県ごと）。
//
// 古いアプリが読む `/app/data/spots.json` は `spotFeed.ts` のまま、**2026-10-07 の公開行に固定**
// （`content/spots-feed-legacy.json`・`legacySpotFeed`）。これ以上は増やさない。
//
// 🔴 台帳（`SPOTS`）を値で読む。**`"use client"` から import しない**。

import { SPOTS, type Spot } from "./spots";
import { SPOT_IMAGES, type SpotImage } from "./spotImages";
import { buildSpotFeed, type SpotFeedItem } from "./spotFeed";
import { prefectureByName, type RegionName } from "./prefectures";

/** 索引の形の版。**形を互換なしに変えるときだけ上げる**（アプリは知らない版なら古い `spots.json` に戻る） */
export const SPOT_FEED_VERSION = 1;

/** 日本の地方 → 区分の鍵。地方の名前は `prefectures.ts` の `REGIONS` */
const JAPAN_AREA_KEYS: Record<RegionName, string> = {
    "北海道": "jp-hokkaido",
    "東北": "jp-tohoku",
    "関東": "jp-kanto",
    "中部": "jp-chubu",
    "近畿": "jp-kinki",
    "中国": "jp-chugoku",
    "四国": "jp-shikoku",
    "九州・沖縄": "jp-kyushu",
};

/**
 * 国（台帳の `region.country`・日本語表記）→ 区分の鍵（ISO 3166-1 alpha-2 の小文字）。
 * **台帳に出る国だけ**（`sunTimes.ts` の `COUNTRY_TIME_ZONES` と同じ持ち方）。
 * 無い国は `OTHER_KEY` に入る——テスト（`spotFeedShards.test.ts`）が公開行の国を全部見張る
 */
export const COUNTRY_SHARD_KEYS: Readonly<Record<string, string>> = {
    フランス: "fr",
    スペイン: "es",
    フィンランド: "fi",
    イタリア: "it",
    ドイツ: "de",
    チェコ: "cz",
    スイス: "ch",
    ギリシャ: "gr",
    イギリス: "gb",
    オランダ: "nl",
    ポルトガル: "pt",
    クロアチア: "hr",
    バチカン市国: "va",
    オーストリア: "at",
    // 2026-10-07 に台帳へ足した海外の行（確認中・#299）。公開したときに `other` へ落ちないよう先に持つ
    台湾: "tw",
    韓国: "kr",
    タイ: "th",
    アメリカ: "us",
    カナダ: "ca",
    ベトナム: "vn",
    シンガポール: "sg",
    香港: "hk",
    マカオ: "mo",
    中国: "cn",
    インドネシア: "id",
    マレーシア: "my",
    インド: "in",
    スリランカ: "lk",
    トルコ: "tr",
    ヨルダン: "jo",
    アラブ首長国連邦: "ae",
    モロッコ: "ma",
    エジプト: "eg",
    イラン: "ir",
    メキシコ: "mx",
    ペルー: "pe",
    アルゼンチン: "ar",
    オーストラリア: "au",
    ニュージーランド: "nz",
    ジンバブエ: "zw",
    アイスランド: "is",
    ノルウェー: "no",
    デンマーク: "dk",
    スウェーデン: "se",
    アイルランド: "ie",
    ハンガリー: "hu",
    ポーランド: "pl",
    ベルギー: "be",
    スロベニア: "si",
    // 2026-10-08 に台帳へ足したアジアの行（確認中）。公開したときに `other` へ落ちないよう先に持つ
    カンボジア: "kh",
    フィリピン: "ph",
    // 2026-10-08 アジアの撮影スポット第3弾（確認中）
    ラオス: "la",
    ミャンマー: "mm",
    モンゴル: "mn",
    ウズベキスタン: "uz",
    ジョージア: "ge",
    // 2026-10-08 アメリカ大陸・オセアニア・南アジア・中東・アフリカ（確認中）
    ブラジル: "br",
    チリ: "cl",
    ネパール: "np",
    南アフリカ: "za",
    ケニア: "ke",
    タンザニア: "tz",
};

/** 表に無い国・県の分からない日本の行 */
export const OTHER_KEY = "other";
const JAPAN_UNKNOWN_KEY = "jp-other";

/**
 * 1行の区分の鍵。日本は地方、海外は国。
 * 2026-10-07 判断: 日本を県（47）で割ると、いまは1区分20件前後で要求が細かすぎる。
 * 地方（8）なら1区分 約130件・約110KB。1万件に増えて区分が 500KB を超えたら県で割る
 * （テストの上限 `SHARD_MAX_BYTES` が知らせる）
 */
export function shardKey(item: Pick<SpotFeedItem, "region">): string {
    const country = item.region?.country?.trim();
    if (country && country !== "日本") return COUNTRY_SHARD_KEYS[country] ?? OTHER_KEY;
    const pref = prefectureByName(item.region?.prefecture);
    return pref ? JAPAN_AREA_KEYS[pref.region] : JAPAN_UNKNOWN_KEY;
}

/**
 * 索引の1行。**文は入れない**（季節・時間帯は「種類」だけ・写真は「有る」だけ）。
 * 名前の鍵は `spots.json` の行と同じ（アプリは同じ読み方で読む）
 */
export type SpotIndexRow = {
    spotId: string;
    slug: string;
    name: string;
    nameEn?: string;
    reading?: string;
    /** 別名（`spot-search.json` と同じもの）。アプリの「さがす」が当てる */
    aliases?: string[];
    region: SpotFeedItem["region"];
    coords?: { lat: number; lng: number };
    category?: string;
    stage: SpotFeedItem["stage"];
    /** 季節の案内がある季節（文は詳細） */
    seasons?: string[];
    /** 時間帯の案内がある時間帯（文は詳細） */
    times?: string[];
    /** 写真（`image`）が詳細にある */
    hasImage?: true;
};

/**
 * 区分1つ。**索引の行は区分ごとに入れる**（行ごとに区分の名前を書くと 1行 約20バイト重い）。
 * 詳細は `/app/data/spot-feed/<key>.json`
 */
export type SpotShardInfo = {
    key: string;
    /** 行の数 */
    count: number;
    /** 区分のファイルの大きさ（minify・UTF-8 のバイト数） */
    bytes: number;
    /**
     * 区分のファイルの指紋（長さ + FNV-1a 64 ビットの16進。iOS の `ValidatorStore.fingerprint` と同じ式）。
     * **アプリは端末の控えの指紋が同じなら取りに行かない**（区分ごとの 304 の往復も要らない）
     */
    hash: string;
    /** この区分の索引の行（並びは台帳の順） */
    spots: SpotIndexRow[];
};

export type SpotIndexFile = {
    v: number;
    shards: SpotShardInfo[];
};

/** 長さ + FNV-1a（64 ビット）。iOS の `ValidatorStore.fingerprint` と同じ（暗号の強さは要らない） */
export function fingerprint(text: string): string {
    const bytes = Buffer.from(text, "utf8");
    // BigInt のリテラル（`0x…n`）は tsconfig の target（ES2017）で書けないので BigInt() で作る
    let hash = BigInt("0xcbf29ce484222325");
    const prime = BigInt("0x100000001b3");
    const mask = BigInt("0xffffffffffffffff");
    for (const b of bytes) {
        hash ^= BigInt(b);
        hash = (hash * prime) & mask;
    }
    return `${bytes.length}-${hash.toString(16)}`;
}

function compact<T extends object>(obj: T): T {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/** 詳細の行（`toSpotFeedItem`）と台帳の行から、索引の行 */
export function toSpotIndexRow(item: SpotFeedItem, spot: Pick<Spot, "aliases"> | undefined): SpotIndexRow {
    const aliases = (spot?.aliases ?? []).map((a) => a.trim()).filter((a) => a);
    return compact({
        spotId: item.spotId,
        slug: item.slug,
        name: item.name,
        nameEn: item.nameEn,
        reading: item.reading,
        aliases: aliases.length ? aliases : undefined,
        region: item.region,
        coords: item.coords,
        category: item.category,
        stage: item.stage,
        seasons: item.seasonalGuide?.length ? item.seasonalGuide.map((g) => g.season) : undefined,
        times: item.timeOfDayGuide?.length ? item.timeOfDayGuide.map((g) => g.time) : undefined,
        hasImage: item.image ? (true as const) : undefined,
    });
}

export type SpotShardFeed = {
    index: SpotIndexFile;
    /** 区分の鍵 → 配る文字列（minify） */
    shardJson: Map<string, string>;
};

/** 純関数。テストは固定の台帳を渡す */
export function buildSpotShardFeed(
    spots: readonly Spot[],
    images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES,
): SpotShardFeed {
    const items = buildSpotFeed(spots, images);
    const ledger = new Map(spots.map((s) => [s.spotId, s]));
    const groups = new Map<string, SpotFeedItem[]>();
    for (const item of items) {
        const key = shardKey(item);
        const list = groups.get(key) ?? [];
        list.push(item);
        groups.set(key, list);
    }
    const shardJson = new Map<string, string>();
    const shards: SpotShardInfo[] = [];
    for (const key of [...groups.keys()].sort()) {
        const list = groups.get(key)!;
        const json = JSON.stringify(list);
        shardJson.set(key, json);
        shards.push({
            key, count: list.length, bytes: Buffer.byteLength(json, "utf8"), hash: fingerprint(json),
            spots: list.map((item) => toSpotIndexRow(item, ledger.get(item.spotId))),
        });
    }
    return { index: { v: SPOT_FEED_VERSION, shards }, shardJson };
}

let memo: SpotShardFeed | undefined;
/** 実際に配るもの。ビルドの中で何度も呼ばれるので1回だけ組み立てる */
export function spotShardFeed(): SpotShardFeed {
    memo ??= buildSpotShardFeed(SPOTS);
    return memo;
}

/** 試験用: 組み立てた結果を捨てる（台帳を差し替えた試験のあと） */
export function resetSpotShardFeedMemo(): void {
    memo = undefined;
}

/** 配るファイルの名前（`index.json` と `<区分>.json`） */
export function spotFeedFiles(): string[] {
    return ["index.json", ...[...spotShardFeed().shardJson.keys()].map((k) => `${k}.json`)];
}

/** ファイル名 → 配る文字列。無ければ undefined */
export function spotFeedFileJson(file: string): string | undefined {
    const feed = spotShardFeed();
    if (file === "index.json") return JSON.stringify(feed.index);
    const m = /^([a-z0-9-]+)\.json$/.exec(file);
    return m ? feed.shardJson.get(m[1]) : undefined;
}
