// lib/data/spotTopics.ts（サーバー専用・ビルド時に焼く）
//
// **撮影スポットの「切り口の一覧」**——国・テーマ（カテゴリ × 地域）・季節（2026-10-11）。
//
// owner の方針（2026-10-11・最優先「検索で見つけてもらう」）:
//   - 海外 814件が `/spots/area/overseas` の1頁（約1.3MB）だった → **国ごとに分ける**
//   - 「京都府の寺社の撮影スポット」「秋の撮影スポット（近畿）」のような**検索語の形の頁**を作る
//   - **データの事実だけを載せる**（件数・スポット名・台帳の季節の案内）
//   - **薄い頁を量産しない**——テーマ・季節の地方別は `MIN_TOPIC_SPOTS` 件以上の組だけ
//
// 2026-10-11 判断: 頁に載せるのは**公開済み（`isPublished`）の行だけ**。下書きを建てる設定
// （`BUILD_DRAFT_SPOTS`）に戻しても、切り口の頁は下書きを検索の着地点にしない
// （`sameAreaSpots` と同じ線）。
//
// 🔴 台帳（`SPOTS`）を値で読む。**`"use client"` から import しない**
// （`spotLink.ts` の冒頭・見張りは `spotLedgerClientImport.test.ts`）。
// 画面へは下の `TopicCard` / `TopicLink` に落としてから渡す。

import { SPOTS, type Spot, type SpotSeason } from "./spots";
import { visibleSpots, isPublished } from "../utils/spotGuide";
import { spotCoverImage, spotCoverLarge, spotCoverSize } from "./spotImages";
import { spotThumbSrc, spotThumbExists } from "./spotThumbs";
import { COUNTRY_SHARD_KEYS } from "./spotFeedShards";
import { REGIONS, prefectureByName, OVERSEAS_SLUG, OVERSEAS_NAME, type RegionName } from "./prefectures";
import { siteConfig, generateItemListStructuredData, generateBreadcrumbStructuredData, pageRobots, shareOgImage, shareImageUrl } from "../utils/seo";
import { ROUTES } from "../routes";

/**
 * テーマ・季節の地方別の頁を作る最小の件数。**これ未満の組は頁を作らない**
 * （5件に満たない「◯◯の△△」は、個別頁の寄せ集めで中身が薄い）
 */
export const MIN_TOPIC_SPOTS = 5;

/**
 * 国の頁を検索に出す最小の件数。**`app/spots/area/[area]/page.tsx` の
 * `MIN_INDEXABLE_AREA` と同じ線**——1件の国の頁はそのスポットの個別頁と食い合う。
 * 頁は建てる（国の一覧から行き止まりにしない）が `noindex`・サイトマップ外
 */
export const MIN_INDEXABLE_COUNTRY = 2;

/** 季節の並び（台帳の `SpotSeason` の順） */
export const SEASONS: readonly SpotSeason[] = ["spring", "summer", "autumn", "winter"];
export const SEASON_JA: Record<SpotSeason, string> = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" };
export const SEASON_EN: Record<SpotSeason, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };

/**
 * 季節の案内の文に出てくる、検索でよく打たれる語（導入文で件数を数えるだけ）。
 * **頁の題には使わない**——秋の頁の全部が紅葉の案内ではない
 */
const SEASON_KEYWORD: Partial<Record<SpotSeason, string>> = { spring: "桜", autumn: "紅葉", winter: "雪" };
// 夏は置かない（多いのは「緑」「青」で、季節らしさを言う語にならない・2026-10-11 台帳で数えた）

/** その季節の案内に、その季節の語（`SEASON_KEYWORD`）がある行か。**その季節の項目だけを見る** */
export function hasSeasonKeyword(s: Spot, season: SpotSeason): boolean {
    const kw = SEASON_KEYWORD[season];
    return Boolean(kw) && (s.seasonalGuide ?? []).some((g) => g?.season === season && Boolean(g.text?.includes(kw!)));
}

/** 地方 → URL の綴り（季節の地方別・テーマの地方別で共用） */
export const REGION_SLUGS: Record<RegionName, string> = {
    "北海道": "hokkaido",
    "東北": "tohoku",
    "関東": "kanto",
    "中部": "chubu",
    "近畿": "kinki",
    "中国": "chugoku",
    "四国": "shikoku",
    "九州・沖縄": "kyushu-okinawa",
};

/**
 * 地方の呼び名。**「中国」は国の中国と紛れるので「中国地方」**（台帳に国の中国が56件ある）。
 * 近畿は検索でよく打たれる「関西」を添える
 */
export const REGION_LABEL: Record<RegionName, string> = {
    "北海道": "北海道",
    "東北": "東北地方",
    "関東": "関東地方",
    "中部": "中部地方",
    "近畿": "近畿地方（関西）",
    "中国": "中国地方",
    "四国": "四国地方",
    "九州・沖縄": "九州・沖縄",
};

/** 地方の英語名（英語表示の枠だけに使う） */
export const REGION_EN: Record<RegionName, string> = {
    "北海道": "Hokkaido", "東北": "Tohoku", "関東": "Kanto", "中部": "Chubu",
    "近畿": "Kansai", "中国": "Chugoku", "四国": "Shikoku", "九州・沖縄": "Kyushu & Okinawa",
};

/** カテゴリの英語名。綴り（`CATEGORY_SLUGS`）から作り、読みにくいものだけ手で書く */
const CATEGORY_EN_OVERRIDE: Record<string, string> = { "temples-shrines": "Temples & shrines", "lakes-ponds": "Lakes & ponds" };
export function categoryEn(categorySlug: string): string {
    const o = CATEGORY_EN_OVERRIDE[categorySlug];
    if (o) return o;
    const t = categorySlug.replace(/-/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
}

/** 国の英語名（台帳に無いので ISO の2文字から引く）。引けなければ2文字を大文字で */
let regionNames: Intl.DisplayNames | null = null;
export function countryEn(code: string): string {
    try {
        regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
        return regionNames.of(code.toUpperCase()) ?? code.toUpperCase();
    } catch {
        return code.toUpperCase();
    }
}

/**
 * カテゴリ（台帳の `category`）→ URL の綴り。**台帳に出るものは全部持つ**
 * （無いカテゴリはテーマの頁が作られない。見張りは `spotTopics.test.ts`——
 * 頁になる件数のカテゴリが表に無ければ落ちる）
 */
export const CATEGORY_SLUGS: Readonly<Record<string, string>> = {
    寺社: "temples-shrines", 寺院: "temples", 神社: "shrines", 教会: "churches", 仏像: "buddha-statues",
    城: "castles", 城跡: "castle-ruins", 宮殿: "palaces", 史跡: "historic-sites", 遺跡: "ruins",
    産業遺産: "industrial-heritage", 古道: "old-roads",
    町並み: "old-townscapes", 街並み: "streetscapes", 街: "towns", 集落: "villages", 農村: "rural-villages",
    温泉街: "onsen-towns", 広場: "squares", 市場: "markets", 運河: "canals", 駅: "stations", 鉄道: "railways",
    建築: "architecture", 橋: "bridges", 展望台: "observation-decks", 灯台: "lighthouses", ダム: "dams",
    道路: "scenic-roads", 劇場: "theaters", 博物館: "museums", 美術館: "art-museums", アート: "art",
    水族館: "aquariums", 動物園: "zoos", 植物園: "botanical-gardens", 庭園: "gardens", 公園: "parks",
    花畑: "flower-fields", 花園: "flower-gardens", 並木道: "tree-lined-avenues", 樹木: "notable-trees",
    棚田: "rice-terraces", 農場: "farms", 祭り: "festivals", 夜景: "night-views", 温泉: "hot-springs",
    山岳: "mountains", 火山: "volcanoes", 高原: "highlands", 草原: "grasslands", 森林: "forests",
    渓谷: "gorges", 峡谷: "canyons", 渓流: "mountain-streams", 滝: "waterfalls", 湧水: "springs",
    湖沼: "lakes-ponds", 湖: "lakes", 池: "ponds", 火口湖: "crater-lakes", 湿原: "wetlands",
    海岸: "coasts", 岬: "capes", 湾: "bays", 海峡: "straits", 島: "islands", 諸島: "archipelagos",
    砂丘: "sand-dunes", 鍾乳洞: "limestone-caves", 洞窟: "caves", 動物: "wildlife", 自然現象: "natural-phenomena",
};

// ─────────────────────────────────────────────────────────────
// 画面へ渡す形
// ─────────────────────────────────────────────────────────────

/** 一覧のカード1枚。**画面が読む項目だけ**（`SpotIndexItem` と同じ考え方） */
export type TopicCard = {
    slug: string;
    name: string;
    /** 「京都府 京都市」・海外は「フランス イル・ド・フランス」 */
    region: string;
    summary?: string;
    /**
     * 代表写真（`spotCoverImage`＝スポットの頁と同じ判断）。**サムネが在ればサムネ**
     * （短い辺 240px・`spotThumbs.ts`）。`credit` は表示が条件のとき（CC BY 系）の文字
     */
    cover: { src: string; alt: string; credit: TopicCredit | null } | null;
};

/**
 * 写真の表示（CC BY・CC BY-SA の条件＝作者・ライセンス（文面へ）・出典）。スポットの頁
 * （`SpotGuideClient` の代表写真の下）と同じ中身。`text` はライセンス名の無い写真の表記
 */
export type TopicCredit = { author: string; license?: string; licenseUrl?: string; sourceUrl?: string; text?: string };

/** 別の切り口の頁へのリンク。`labelEn` は英語表示のとき（無ければ日本語のまま） */
export type TopicLink = { href: string; label: string; labelEn?: string; count: number };

/** 頁の中身（`SpotTopicPage` が描く） */
export type TopicView = {
    path: string;
    /** h1・題（「京都府の寺社の撮影スポット」） */
    heading: string;
    /** 英語表示の h1（枠だけ英語にする。導入文・カードは日本語のまま） */
    headingEn: string;
    /** 導入文（データから組み立てた事実だけ） */
    intro: string;
    /** パンくず（ホーム・撮影スポットの後ろ、自分の前まで） */
    crumbs: Array<{ name: string; nameEn: string; href: string }>;
    cards: TopicCard[];
    /** 関連する切り口（見出しごと） */
    related: Array<{ heading: string; headingEn: string; links: TopicLink[] }>;
    /** 説明（`description`）に足す事実（導入文の後ろ・数えた件数だけ） */
    descriptionExtra?: string;
    /** OGP の画像（**元の大きさ**の代表写真・サムネではない）。クライアントへは渡さない */
    ogImage?: { src: string; alt: string; width?: number; height?: number };
    /** 検索に出すか */
    indexable: boolean;
    /** 中身の最終更新（載せたスポットの `updatedAt` の最大） */
    lastModified?: string;
};

// ─────────────────────────────────────────────────────────────
// 母集合と分け方
// ─────────────────────────────────────────────────────────────

/** 切り口の頁に載せてよい行（**建てられて・公開済み**）。配列ごとに1回だけ数える */
const shownCache = new WeakMap<readonly Spot[], Spot[]>();
export function topicSpots(spots: readonly Spot[] = SPOTS): Spot[] {
    let rows = shownCache.get(spots);
    if (!rows) {
        rows = visibleSpots(spots).filter(isPublished);
        shownCache.set(spots, rows);
    }
    return rows;
}

/**
 * 分け方は**台帳の配列ごとに1回だけ**計算する。スポットの頁（約1,800枚）が1枚ごとに
 * `topicLinksForSpot` を呼ぶので、毎回組み直すと件数の2乗で遅くなる（`spotSeo.ts` の
 * `publishedVisibleOf` と同じ理由）。台帳の配列は作り直さないので、同じ配列なら結果も同じ
 */
const countryCache = new WeakMap<readonly Spot[], CountryTopic[]>();
const themeCache = new WeakMap<readonly Spot[], ThemeTopic[]>();
const seasonCache = new WeakMap<readonly Spot[], SeasonTopic[]>();
function memo<T>(cache: WeakMap<readonly Spot[], T>, spots: readonly Spot[], build: (s: readonly Spot[]) => T): T {
    let v = cache.get(spots);
    if (v === undefined) {
        v = build(spots);
        cache.set(spots, v);
    }
    return v;
}

const isJapan = (s: Spot) => s.region?.country === "日本";
const regionOf = (s: Spot): RegionName | null => (isJapan(s) ? prefectureByName(s.region?.prefecture)?.region ?? null : null);
const hasSeason = (s: Spot, season: SpotSeason) => (s.seasonalGuide ?? []).some((g) => g?.season === season);

/** 国の2文字（小文字）。表に無い国は `null`（頁を作らない） */
export function countryCode(country: string | undefined): string | null {
    return country && country !== "日本" ? COUNTRY_SHARD_KEYS[country] ?? null : null;
}

export type CountryTopic = { code: string; name: string; spots: Spot[] };

/** 海外の国ごと。**件数の多い順**（同数は名前の順） */
export function countryTopics(spots: readonly Spot[] = SPOTS): CountryTopic[] {
    return memo(countryCache, spots, buildCountryTopics);
}
function buildCountryTopics(spots: readonly Spot[]): CountryTopic[] {
    const by = new Map<string, CountryTopic>();
    for (const s of topicSpots(spots)) {
        const code = countryCode(s.region?.country);
        if (!code) continue;
        const t = by.get(code) ?? { code, name: s.region!.country!, spots: [] };
        t.spots.push(s);
        by.set(code, t);
    }
    return [...by.values()].sort((a, b) => b.spots.length - a.spots.length || a.name.localeCompare(b.name, "ja"));
}

/** テーマの「地域」側。県・地方・国のどれか */
export type TopicPlace =
    | { kind: "prefecture"; slug: string; name: string; areaSlug: string; region: RegionName }
    | { kind: "region"; slug: string; name: string; region: RegionName }
    | { kind: "country"; slug: string; name: string };

export type ThemeTopic = { category: string; categorySlug: string; place: TopicPlace; spots: Spot[] };

/**
 * テーマ（カテゴリ × 地域）。**`MIN_TOPIC_SPOTS` 件以上の組だけ。**
 *
 * 地域は3段: 都道府県・地方（日本）・国（海外）。地方の頁が県の頁と**同じ顔ぶれ**になる
 * とき（北海道は1県1地方）は地方の側を作らない（同じ中身の頁を2枚にしない）。
 * 並びは**カテゴリの件数の多い順 → 県・地方・国の順 → 件数の多い順**
 */
export function themeTopics(spots: readonly Spot[] = SPOTS): ThemeTopic[] {
    return memo(themeCache, spots, buildThemeTopics);
}
function buildThemeTopics(spots: readonly Spot[]): ThemeTopic[] {
    const groups = new Map<string, ThemeTopic>();
    const add = (s: Spot, place: TopicPlace) => {
        const category = (s.category ?? "").trim();
        const categorySlug = CATEGORY_SLUGS[category];
        if (!categorySlug) return;
        // 🔴 **鍵に種類を入れる。** 北海道は県と地方の綴りがどちらも `hokkaido` で、綴りだけを鍵に
        // すると同じスポットが県と地方で2回数えられ、3件の組が「6件」になって頁ができていた
        const key = `${place.kind}/${categorySlug}/${place.slug}`;
        const g = groups.get(key) ?? { category, categorySlug, place, spots: [] };
        g.spots.push(s);
        groups.set(key, g);
    };
    for (const s of topicSpots(spots)) {
        if (isJapan(s)) {
            const pref = prefectureByName(s.region?.prefecture);
            if (!pref) continue;
            add(s, { kind: "prefecture", slug: pref.slug, name: pref.name, areaSlug: pref.slug, region: pref.region });
            add(s, { kind: "region", slug: REGION_SLUGS[pref.region], name: REGION_LABEL[pref.region], region: pref.region });
        } else {
            const code = countryCode(s.region?.country);
            if (code) add(s, { kind: "country", slug: code, name: s.region!.country! });
        }
    }
    const kept = [...groups.values()].filter((g) => g.spots.length >= MIN_TOPIC_SPOTS);
    // 地方の頁が、同じカテゴリ・その地方の県の頁と同じ顔ぶれなら落とす
    // （県の頁はその地方の部分集合なので、件数が同じなら顔ぶれも同じ）
    const sameAsPrefecture = (g: ThemeTopic) => g.place.kind === "region" && kept.some((o) =>
        o.place.kind === "prefecture" && o.categorySlug === g.categorySlug
        && g.place.kind === "region" && o.place.region === g.place.region && o.spots.length === g.spots.length);
    // 同じ URL になる組（北海道の県と地方）は**県・国を残して地方を捨てる**
    const kindRank = { prefecture: 0, country: 1, region: 2 } as const;
    const byPath = new Map<string, ThemeTopic>();
    for (const g of [...kept].sort((a, b) => kindRank[a.place.kind] - kindRank[b.place.kind])) {
        if (sameAsPrefecture(g)) continue;
        const path = themePath(g);
        if (!byPath.has(path)) byPath.set(path, g);
    }
    const out = [...byPath.values()];
    const catCount = new Map<string, number>();
    for (const s of topicSpots(spots)) if (s.category) catCount.set(s.category, (catCount.get(s.category) ?? 0) + 1);
    const kindOrder = { prefecture: 0, region: 1, country: 2 } as const;
    return out.sort((a, b) =>
        (catCount.get(b.category) ?? 0) - (catCount.get(a.category) ?? 0)
        || a.category.localeCompare(b.category, "ja")
        || kindOrder[a.place.kind] - kindOrder[b.place.kind]
        || b.spots.length - a.spots.length
        || a.place.slug.localeCompare(b.place.slug));
}

/** 季節の頁。`region` が無ければ全体、`"overseas"` は海外 */
export type SeasonTopic = {
    season: SpotSeason;
    /** 地方の綴り（`REGION_SLUGS`）か `OVERSEAS_SLUG`。全体の頁は `null` */
    area: string | null;
    /** 地方の呼び名（`REGION_LABEL`）か「海外」。全体は `null` */
    areaName: string | null;
    spots: Spot[];
};

/**
 * 季節（台帳の `seasonalGuide` にその季節の項目を持つスポット）。
 *
 * - 全体の頁は**1件でもあれば**作る（4枚だけ・入口になる）
 * - 地方別・海外は `MIN_TOPIC_SPOTS` 件以上のときだけ
 *
 * ⚠️ 南半球の行（オーストラリアなど）の「秋」は3〜5月。頁は季節の名前だけを言い、
 * **月は名乗らない**（ホームの「いまの季節」だけが月を使い、そこでは南半球を外す）
 */
export function seasonTopics(spots: readonly Spot[] = SPOTS): SeasonTopic[] {
    return memo(seasonCache, spots, buildSeasonTopics);
}
function buildSeasonTopics(spots: readonly Spot[]): SeasonTopic[] {
    const out: SeasonTopic[] = [];
    const rows = topicSpots(spots);
    for (const season of SEASONS) {
        const all = rows.filter((s) => hasSeason(s, season));
        if (all.length === 0) continue;
        out.push({ season, area: null, areaName: null, spots: all });
        for (const r of REGIONS) {
            const list = all.filter((s) => regionOf(s) === r);
            if (list.length >= MIN_TOPIC_SPOTS) out.push({ season, area: REGION_SLUGS[r], areaName: REGION_LABEL[r], spots: list });
        }
        const overseas = all.filter((s) => !isJapan(s));
        if (overseas.length >= MIN_TOPIC_SPOTS) out.push({ season, area: OVERSEAS_SLUG, areaName: OVERSEAS_NAME, spots: overseas });
    }
    return out;
}

// ─────────────────────────────────────────────────────────────
// 題・道・導入文
// ─────────────────────────────────────────────────────────────

export const themeHeading = (t: Pick<ThemeTopic, "category" | "place">) => `${t.place.name}の${t.category}の撮影スポット`;

/** 地域の英語名（県・地方・国） */
export function placeEn(p: TopicPlace): string {
    if (p.kind === "prefecture") return prefectureByName(p.name)?.nameEn ?? p.name;
    if (p.kind === "region") return REGION_EN[p.region];
    return countryEn(p.slug);
}
const seasonAreaEn = (area: string | null) => {
    if (!area) return null;
    if (area === OVERSEAS_SLUG) return "outside Japan";
    const r = (Object.keys(REGION_SLUGS) as RegionName[]).find((k) => REGION_SLUGS[k] === area);
    return r ? `in ${REGION_EN[r]}` : null;
};
export const themeHeadingEn = (t: Pick<ThemeTopic, "categorySlug" | "place">) => `${categoryEn(t.categorySlug)} photo spots in ${placeEn(t.place)}`;
export const seasonHeadingEn = (t: Pick<SeasonTopic, "season" | "area">) =>
    `${SEASON_EN[t.season]} photo spots${t.area ? ` ${seasonAreaEn(t.area)}` : ""}`;
export const countryHeadingEn = (t: Pick<CountryTopic, "code">) => `Photo spots in ${countryEn(t.code)}`;
export const seasonHeading = (t: Pick<SeasonTopic, "season" | "areaName">) =>
    `${t.areaName ? `${t.areaName}の` : ""}${SEASON_JA[t.season]}の撮影スポット`;
export const countryHeading = (t: Pick<CountryTopic, "name">) => `${t.name}の撮影スポット`;

export const themePath = (t: Pick<ThemeTopic, "categorySlug" | "place">) => ROUTES.SPOT_THEME(t.categorySlug, t.place.slug);
export const seasonPath = (t: Pick<SeasonTopic, "season" | "area">) => ROUTES.SPOT_SEASON(t.season, t.area ?? undefined);

/**
 * 代表写真（スポットの頁と同じ判断）。サムネが在ればサムネ。
 * 県の頁（`/spots/area/<県>`・`spotIndexItemsForArea`）のカードも同じものを使う（2026-10-22）
 */
export function topicCardCover(s: Spot): TopicCard["cover"] {
    const c = spotCoverImage(s);
    if (!c?.src) return null;
    const thumb = spotThumbSrc(c.src);
    const src = thumb && spotThumbExists(thumb) ? thumb : c.src;
    // CC BY・CC BY-SA は作者とライセンスの表示が条件（運営の写真で表記の求めが無いときだけ出さない）
    const showCredit = c.license !== "owner" || Boolean(c.requiredCreditText?.trim());
    let credit: TopicCredit | null = null;
    if (showCredit) {
        // スポットの頁と同じ分け方: ライセンス名があれば「作者 / ライセンス（文面へ）/ 出典」、
        // 無ければ求められた表記（`requiredCreditText`）か作者
        const author = (c.credit || "").trim();
        if (c.licenseLabel && author) {
            credit = { author, license: c.licenseLabel,
                ...(c.licenseUrl ? { licenseUrl: c.licenseUrl } : {}), ...(c.sourceUrl ? { sourceUrl: c.sourceUrl } : {}) };
        } else {
            const text = (c.requiredCreditText || author).trim();
            if (text) credit = { author, text };
        }
    }
    return { src, alt: c.alt || s.name, credit };
}

export function toTopicCard(s: Spot): TopicCard {
    return {
        slug: s.slug,
        name: s.name,
        region: [isJapan(s) ? undefined : s.region?.country, s.region?.prefecture, s.region?.city].filter(Boolean).join(" "),
        ...(s.summary ? { summary: s.summary } : {}),
        cover: topicCardCover(s),
    };
}

/** カードの並び: **代表写真のあるものを先に**、その中は台帳の順のまま */
export function topicCards(spots: readonly Spot[]): TopicCard[] {
    const cards = spots.map(toTopicCard);
    return [...cards.filter((c) => c.cover), ...cards.filter((c) => !c.cover)];
}

/**
 * OGP の画像の1枚（**元の大きさ**の代表写真・サムネは 240px で小さすぎる）。寸法つき。
 * 2026-10-22: 横 1,200px 以上の版（`spotCoverLarge`・Commons の 1280px）があればそれ、無ければサイトに置いた 960px
 */
function coverOgOf(s: Spot): { src: string; alt: string; width?: number; height?: number; large: boolean } | undefined {
    const c = spotCoverImage(s);
    if (!c?.src) return undefined;
    const alt = c.alt || s.name;
    const large = spotCoverLarge(s);
    if (large) return { src: large.src, alt, width: large.width, height: large.height, large: true };
    return { src: c.src, alt, ...spotCoverSize(s), large: false };
}

/**
 * 並びの順に見て、**横 1,200px 以上の版を持つ最初の行**の代表写真。どの行にも無ければ、写真のある最初の行の
 * 960px（2026-10-22・SEO。1,200 に届かない写真は代表に選ぶ順を下げる）
 */
function firstOgCover(spots: readonly Spot[]): TopicView["ogImage"] {
    let fallback: ReturnType<typeof coverOgOf>;
    for (const s of spots) {
        const og = coverOgOf(s);
        if (!og) continue;
        if (og.large) return { src: og.src, alt: og.alt, width: og.width, height: og.height };
        if (!fallback) fallback = og;
    }
    if (!fallback) return undefined;
    return { src: fallback.src, alt: fallback.alt, ...(fallback.width && fallback.height ? { width: fallback.width, height: fallback.height } : {}) };
}

/** OGP の画像: カードの並び（写真のある行が先）の順で `firstOgCover` */
function ogImageOf(spots: readonly Spot[], cards: readonly TopicCard[]): TopicView["ogImage"] {
    const bySlug = new Map(spots.map((s) => [s.slug, s]));
    return firstOgCover(cards.filter((c) => c.cover).map((c) => bySlug.get(c.slug)).filter((s): s is Spot => Boolean(s)));
}

/** 説明に足す事実: 時間帯の案内を持つ件数（数えた分だけ。無ければ足さない） */
function timeGuideNote(spots: readonly Spot[]): string | undefined {
    const k = spots.filter((s) => (s.timeOfDayGuide ?? []).length > 0).length;
    return k > 0 ? `時間帯ごとの撮影の案内があるのは${k}件です。` : undefined;
}

const names = (cards: readonly TopicCard[], n = 3) => cards.slice(0, n).map((c) => c.name).join("、");

/** カテゴリの内訳（多い順に `n` 個・「寺院14件・山岳12件」） */
function categoryBreakdown(spots: readonly Spot[], n = 3): string {
    const m = new Map<string, number>();
    for (const s of spots) if (s.category) m.set(s.category, (m.get(s.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).slice(0, n)
        .map(([c, k]) => `${c}${k}件`).join("・");
}

const seasonalCount = (spots: readonly Spot[]) => spots.filter((s) => (s.seasonalGuide ?? []).length > 0).length;
const latest = (spots: readonly Spot[]) => spots.map((s) => s.updatedAt).filter(Boolean).sort().pop();

/** 国の頁の導入文 */
export function countryIntro(t: CountryTopic, cards: readonly TopicCard[]): string {
    const n = t.spots.length;
    const kinds = categoryBreakdown(t.spots);
    return `${t.name}の撮影スポットを${n}件まとめました。`
        + (kinds ? `種類は${kinds}など。` : "")
        + (n > 1 ? `${names(cards)}${n > 3 ? "ほか" : ""}を載せています。` : "");
}

/** テーマの頁の導入文 */
export function themeIntro(t: ThemeTopic, cards: readonly TopicCard[]): string {
    const n = t.spots.length;
    const seasonal = seasonalCount(t.spots);
    return `${t.place.name}にある${t.category}の撮影スポットを${n}件まとめました。${names(cards)}など。`
        + (seasonal > 0 ? `うち${seasonal}件は季節ごとの撮影の案内があります。` : "");
}

/** 季節の頁の導入文 */
export function seasonIntro(t: SeasonTopic, cards: readonly TopicCard[]): string {
    const n = t.spots.length;
    const label = SEASON_JA[t.season];
    let text = t.area || cards.length >= n
        ? `${t.areaName ? `${t.areaName}で、` : ""}${label}の撮影の案内があるスポットを${n}件まとめました。${names(cards)}など。`
        : `${label}の撮影の案内があるスポットは${n}件あります。この頁には${names(cards)}など${cards.length}件を載せ、ほかは地方別の頁にあります。`;
    const kw = SEASON_KEYWORD[t.season];
    if (kw) {
        const k = t.spots.filter((s) => hasSeasonKeyword(s, t.season)).length;
        if (k > 0) text += `うち${k}件は${label}の案内に「${kw}」の記述があります。`;
    }
    if (!t.area) {
        // 全体の頁は地方の内訳（多い順に3つ）
        const m = new Map<string, number>();
        for (const s of t.spots) {
            const r = regionOf(s);
            const key = r ? REGION_LABEL[r] : OVERSEAS_NAME;
            m.set(key, (m.get(key) ?? 0) + 1);
        }
        const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, k]) => `${r}${k}件`).join("・");
        if (top) text += `多いのは${top}です。`;
    }
    return text;
}

// ─────────────────────────────────────────────────────────────
// 頁の組み立て
// ─────────────────────────────────────────────────────────────

const link = (href: string, label: string, count: number): TopicLink => ({ href, label, count });
const themeLink = (t: ThemeTopic): TopicLink => ({
    ...link(themePath(t), `${t.place.name}の${t.category}`, t.spots.length),
    labelEn: `${categoryEn(t.categorySlug)} in ${placeEn(t.place)}`,
});
const seasonLink = (t: SeasonTopic): TopicLink => ({
    ...link(seasonPath(t), seasonHeading(t).replace(/の撮影スポット$/, ""), t.spots.length),
    labelEn: `${SEASON_EN[t.season]}${t.area ? ` ${seasonAreaEn(t.area)}` : ""}`,
});
const countryLink = (t: CountryTopic): TopicLink => ({ ...link(ROUTES.SPOT_COUNTRY(t.code), t.name, t.spots.length), labelEn: countryEn(t.code) });
const OVERSEAS_CRUMB = () => ({ name: OVERSEAS_NAME, nameEn: "Outside Japan", href: ROUTES.SPOT_AREA(OVERSEAS_SLUG) });

/** 海外の一覧（`/spots/area/overseas`）: 国の一覧。カードは出さない（国の頁に分けた） */
export function overseasView(spots: readonly Spot[] = SPOTS): TopicView {
    const countries = countryTopics(spots);
    const total = countries.reduce((n, c) => n + c.spots.length, 0);
    const top = countries.slice(0, 3).map((c) => `${c.name}${c.spots.length}件`).join("・");
    return {
        path: ROUTES.SPOT_AREA(OVERSEAS_SLUG),
        heading: `${OVERSEAS_NAME}の撮影スポット`,
        headingEn: "Photo spots outside Japan",
        intro: total > 0
            ? `海外の撮影スポット${total}件を、${countries.length}の国・地域に分けています。多いのは${top}です。`
            : "",
        crumbs: [],
        cards: [],
        related: [
            { heading: "国・地域でさがす", headingEn: "By country or region", links: countries.map(countryLink) },
            {
                heading: "海外のテーマ", headingEn: "Themes outside Japan",
                links: themeTopics(spots).filter((t) => t.place.kind === "country").map(themeLink),
            },
        ].filter((g) => g.links.length > 0),
        indexable: true,
        descriptionExtra: timeGuideNote(countries.flatMap((c) => c.spots)),
        lastModified: latest(countries.flatMap((c) => c.spots)),
    };
}

export function countryView(code: string, spots: readonly Spot[] = SPOTS): TopicView | null {
    const t = countryTopics(spots).find((c) => c.code === code);
    if (!t) return null;
    const cards = topicCards(t.spots);
    const themes = themeTopics(spots).filter((x) => x.place.kind === "country" && x.place.slug === code);
    return {
        path: ROUTES.SPOT_COUNTRY(code),
        heading: countryHeading(t),
        headingEn: countryHeadingEn(t),
        intro: countryIntro(t, cards),
        crumbs: [OVERSEAS_CRUMB()],
        cards,
        related: [
            { heading: `${t.name}のテーマ`, headingEn: `Themes in ${countryEn(code)}`, links: themes.map(themeLink) },
            { heading: "ほかの国・地域", headingEn: "Other countries and regions", links: countryTopics(spots).filter((c) => c.code !== code).slice(0, 12).map(countryLink) },
        ].filter((g) => g.links.length > 0),
        indexable: t.spots.length >= MIN_INDEXABLE_COUNTRY,
        descriptionExtra: timeGuideNote(t.spots),
        ogImage: ogImageOf(t.spots, cards),
        lastModified: latest(t.spots),
    };
}

export function themeView(categorySlug: string, place: string, spots: readonly Spot[] = SPOTS): TopicView | null {
    const all = themeTopics(spots);
    const t = all.find((x) => x.categorySlug === categorySlug && x.place.slug === place);
    if (!t) return null;
    const cards = topicCards(t.spots);
    // 上の段（県の一覧・国の一覧）。地方には一覧の頁が無いので飛ばす
    const parent = t.place.kind === "prefecture"
        ? [{ name: t.place.name, nameEn: placeEn(t.place), href: ROUTES.SPOT_AREA(t.place.areaSlug) }]
        : t.place.kind === "country"
            ? [OVERSEAS_CRUMB(), { name: t.place.name, nameEn: placeEn(t.place), href: ROUTES.SPOT_COUNTRY(t.place.slug) }]
            : [];
    const samePlace = all.filter((x) => x.place.kind === t.place.kind && x.place.slug === t.place.slug && x !== t);
    const sameCategory = all.filter((x) => x.categorySlug === t.categorySlug && x !== t);
    return {
        path: themePath(t),
        heading: themeHeading(t),
        headingEn: themeHeadingEn(t),
        intro: themeIntro(t, cards),
        crumbs: parent,
        cards,
        related: [
            { heading: `${t.place.name}のほかのテーマ`, headingEn: `Other themes in ${placeEn(t.place)}`, links: samePlace.map(themeLink) },
            { heading: `ほかの地域の${t.category}`, headingEn: `${categoryEn(t.categorySlug)} in other areas`, links: sameCategory.map(themeLink) },
        ].filter((g) => g.links.length > 0),
        indexable: true,
        descriptionExtra: timeGuideNote(t.spots),
        ogImage: ogImageOf(t.spots, cards),
        lastModified: latest(t.spots),
    };
}

/**
 * 季節の全体の頁に並べる数。**全部は並べない**（2026-10-11・実ビルド: 秋194件・冬202件を全部並べると
 * 1頁 600KB を超えた）。地方別の頁（全件を並べる）がある行は写真のある先頭からこの数まで、
 * **地方別の頁が無い行（件数の少ない地方・海外）は全部**載せる——どの行も、どこかの季節の頁から辿れる
 */
export const SEASON_TOP_CARDS = 36;

/**
 * 全体の頁の並び（2026-10-11 見直し）。**読み順の先頭36件にしない**——台帳の先頭は五十音の
 * 「あ」で、地方も偏る（秋は阿寺渓谷・愛知県庁が先頭だった）。
 *
 * 1. 地方（海外は1つ）ごとに、**写真がある → その季節の語（秋は「紅葉」）が案内にある → 台帳の順**で並べる
 * 2. 地方を**順に1件ずつ**取る（多い地方が並びを占めない）
 * 3. 地方別の頁が無い行は全部残し、ほかは2の順で `SEASON_TOP_CARDS` 件まで
 * 4. 画面の並びも2の順（写真のあるものが先）。題・OGP・導入文の名前はこの先頭から取る
 */
function seasonTopCards(t: SeasonTopic, subs: readonly SeasonTopic[]): TopicCard[] {
    const covered = new Set(subs.flatMap((x) => x.spots.map((s) => s.spotId)));
    const cards = new Map(t.spots.map((s) => [s.spotId, toTopicCard(s)]));
    const rank = (s: Spot) => (cards.get(s.spotId)!.cover ? 0 : 2) + (hasSeasonKeyword(s, t.season) ? 0 : 1);
    const buckets = new Map<string, Spot[]>();
    for (const s of t.spots) {
        const key = regionOf(s) ?? OVERSEAS_SLUG;
        buckets.set(key, [...(buckets.get(key) ?? []), s]);
    }
    const lists = [...buckets.values()].map((l) => l.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s));
    // 地方を順に回す。ただし「写真のある行」を全地方で取り切ってから写真の無い行へ
    const order: Spot[] = [];
    for (const pass of [(s: Spot) => Boolean(cards.get(s.spotId)!.cover), (s: Spot) => !cards.get(s.spotId)!.cover]) {
        const ls = lists.map((l) => l.filter(pass));
        for (let i = 0; ls.some((l) => i < l.length); i++) for (const l of ls) if (i < l.length) order.push(l[i]);
    }
    const orphans = order.filter((s) => !covered.has(s.spotId));
    const rest = order.filter((s) => covered.has(s.spotId)).slice(0, Math.max(0, SEASON_TOP_CARDS - orphans.length));
    const keep = new Set([...orphans, ...rest].map((s) => s.spotId));
    return order.filter((s) => keep.has(s.spotId)).map((s) => cards.get(s.spotId)!);
}

export function seasonView(season: string, area: string | null, spots: readonly Spot[] = SPOTS): TopicView | null {
    const all = seasonTopics(spots);
    const t = all.find((x) => x.season === season && x.area === area);
    if (!t) return null;
    const top = all.find((x) => x.season === t.season && x.area === null)!;
    const subs = all.filter((x) => x.season === t.season && x.area !== null);
    const cards = t.area ? topicCards(t.spots) : seasonTopCards(t, subs);
    const otherSeasons = all.filter((x) => x.season !== t.season && x.area === t.area);
    return {
        path: seasonPath(t),
        heading: seasonHeading(t),
        headingEn: seasonHeadingEn(t),
        intro: seasonIntro(t, cards),
        crumbs: t.area ? [{ name: seasonHeading(top), nameEn: seasonHeadingEn(top), href: seasonPath(top) }] : [],
        cards,
        related: [
            {
                heading: t.area ? `ほかの地方の${SEASON_JA[t.season]}` : "地方でさがす",
                headingEn: t.area ? `${SEASON_EN[t.season]} in other regions` : "By region",
                links: subs.filter((x) => x !== t).map(seasonLink),
            },
            { heading: "ほかの季節", headingEn: "Other seasons", links: otherSeasons.map(seasonLink) },
        ].filter((g) => g.links.length > 0),
        indexable: true,
        descriptionExtra: timeGuideNote(t.spots),
        ogImage: ogImageOf(t.spots, cards),
        lastModified: latest(t.spots),
    };
}

/** 構造化データ（パンくず・並べたスポットの `ItemList`）。**画面に並べたものと同じ順** */
export function topicStructuredData(view: TopicView) {
    const abs = (p: string) => `${siteConfig.url}${p}`;
    const breadcrumb = generateBreadcrumbStructuredData([
        { name: "ホーム", url: siteConfig.url },
        { name: "撮影スポット", url: abs(ROUTES.SPOTS) },
        ...view.crumbs.map((c) => ({ name: c.name, url: abs(c.href) })),
        { name: view.heading, url: abs(view.path) },
    ]);
    // カードの無い頁（海外の国の一覧）は、並べている国のリンクを ItemList にする
    const items = view.cards.length > 0
        ? view.cards.map((c) => ({ name: c.name, url: abs(`/spots/${c.slug}`) }))
        : (view.related[0]?.links ?? []).map((l) => ({ name: `${l.label}の撮影スポット`, url: abs(l.href) }));
    const itemList = items.length > 0 ? generateItemListStructuredData(view.heading, items) : null;
    return { breadcrumb, itemList };
}

/**
 * **OGP の画像に使う代表写真**（台帳の順で、代表写真を持つ最初の行の元の大きさ）。
 * 撮影スポットの入口（`/spots`）は子の `openGraph` が親の画像を消すので、絵が無かった（2026-10-16）
 */
export function firstSpotOgImage(
    spots: readonly Spot[],
    alt: string,
): { url: string; alt: string; width?: number; height?: number } | undefined {
    // 2026-10-22: 横 1,200px 以上の版を持つ行を先に（`firstOgCover`）
    const og = firstOgCover(spots);
    if (!og) return undefined;
    return {
        url: og.src.startsWith("http") ? og.src : `${siteConfig.url}${og.src}`,
        alt,
        ...(og.width && og.height ? { width: og.width, height: og.height } : {}),
    };
}

/**
 * **県の頁（`/spots/area/<県>`）の構造化データと OGP の画像**（2026-10-16・SEO）。
 *
 * 切り口の頁（国・テーマ・季節）はパンくずと `ItemList` と代表写真の OGP を持っていたのに、
 * 一番数の多い入口の県の頁（47頁）だけ、どれも無かった（実ビルドで数えた）。
 * 並びは**画面と同じ**（`spotIndexItemsForArea` ＝ `visibleSpotsInArea` の順）。
 * 画像は切り口の頁と同じ判断（写真のある先頭の行の、元の大きさの代表写真）
 */
export function areaStructuredData(area: { slug: string; name: string }, spots: readonly Spot[]) {
    const abs = (p: string) => `${siteConfig.url}${p}`;
    const path = `${ROUTES.SPOTS}/area/${area.slug}`;
    const heading = `${area.name}の撮影スポット`;
    const breadcrumb = generateBreadcrumbStructuredData([
        { name: "ホーム", url: siteConfig.url },
        { name: "撮影スポット", url: abs(ROUTES.SPOTS) },
        { name: area.name, url: abs(path) },
    ]);
    const items = spots.map((s) => ({ name: s.name, url: abs(`${ROUTES.SPOTS}/${s.slug}`) }));
    const itemList = items.length > 0 ? generateItemListStructuredData(heading, items) : null;
    const og = ogImageOf(spots, topicCards(spots));
    const ogImage = og
        ? {
            url: og.src.startsWith("http") ? og.src : abs(og.src),
            ...(og.width && og.height ? { width: og.width, height: og.height } : {}),
            alt: heading,
        }
        : undefined;
    return { breadcrumb, itemList, ogImage };
}

/** 頁の題（`<title>`）。検索に出す頁は「N選」（県の頁 `/spots/area/<x>` と同じ言い方） */
export function topicTitle(view: TopicView): string {
    const n = view.cards.length;
    return view.indexable && n > 0 ? `${view.heading}${n}選` : view.heading;
}

/**
 * 頁の説明（`description`）。導入文の頭に件数が入っている。
 * 🔴 **決まり文句を足さない**（以前は「見どころ・季節・時間帯の撮影ガイドつき。」を全頁に付けていたが、
 * 季節の案内は全体の約4分の1、時間帯は約2割の行にしか無い）。足すのは数えた事実だけ
 */
export function topicDescription(view: TopicView): string {
    return `${view.intro}${view.descriptionExtra ?? ""}`.slice(0, 160);
}

// ─────────────────────────────────────────────────────────────
// 内部リンク: スポットの頁 → 属する切り口
// ─────────────────────────────────────────────────────────────

/**
 * そのスポットが載っている切り口の頁（国・テーマ・季節）。**頁が在るものだけ**。
 * 並び: 国 → テーマ（県・地方・国）→ 季節（地方別が在ればそちら、無ければ全体）
 */
export function topicLinksForSpot(spot: Spot, spots: readonly Spot[] = SPOTS): TopicLink[] {
    if (!topicSpots(spots).some((s) => s.spotId === spot.spotId)) return [];
    const out: TopicLink[] = [];
    const code = countryCode(spot.region?.country);
    const country = code ? countryTopics(spots).find((c) => c.code === code) : undefined;
    if (country) out.push({ ...link(ROUTES.SPOT_COUNTRY(country.code), countryHeading(country), country.spots.length), labelEn: countryHeadingEn(country) });
    for (const t of themeTopics(spots)) {
        if (t.spots.some((s) => s.spotId === spot.spotId)) out.push({ ...link(themePath(t), themeHeading(t), t.spots.length), labelEn: themeHeadingEn(t) });
    }
    const seasons = seasonTopics(spots);
    for (const season of SEASONS) {
        if (!hasSeason(spot, season)) continue;
        const mine = seasons.filter((t) => t.season === season && t.spots.some((s) => s.spotId === spot.spotId));
        const best = mine.find((t) => t.area !== null) ?? mine.find((t) => t.area === null);
        if (best) out.push({ ...link(seasonPath(best), seasonHeading(best), best.spots.length), labelEn: seasonHeadingEn(best) });
    }
    return out;
}

/**
 * スポットの国の頁（パンくず・「すべて見る」の行き先）。国の頁が在るときだけ。
 * 海外のスポットのパンくずは 海外 → 国 → スポット（区画の一覧は国の一覧になったので、
 * 間に国を入れないと「すべて見る」がスポットの無い頁に飛ぶ）
 */
export function spotCountryRef(spot: Spot, spots: readonly Spot[] = SPOTS): { href: string; name: string; nameEn: string } | null {
    const code = countryCode(spot.region?.country);
    const c = code ? countryTopics(spots).find((x) => x.code === code) : undefined;
    return c ? { href: ROUTES.SPOT_COUNTRY(c.code), name: c.name, nameEn: countryEn(c.code) } : null;
}

// ─────────────────────────────────────────────────────────────
// `/spots` の入口
// ─────────────────────────────────────────────────────────────

/** `/spots` に並べる切り口（季節・テーマ）。テーマはカテゴリごとにまとめる */
export function spotIndexTopics(spots: readonly Spot[] = SPOTS): {
    seasons: TopicLink[];
    themes: Array<{ category: string; categoryEn: string; links: TopicLink[] }>;
} {
    const seasons = seasonTopics(spots).filter((t) => t.area === null)
        .map((t) => ({ ...link(seasonPath(t), seasonHeading(t), t.spots.length), labelEn: seasonHeadingEn(t) }));
    const themes: Array<{ category: string; categoryEn: string; links: TopicLink[] }> = [];
    for (const t of themeTopics(spots)) {
        let g = themes.find((x) => x.category === t.category);
        if (!g) themes.push(g = { category: t.category, categoryEn: categoryEn(t.categorySlug), links: [] });
        g.links.push({ ...link(themePath(t), t.place.name, t.spots.length), labelEn: placeEn(t.place) });
    }
    return { seasons, themes };
}

// ─────────────────────────────────────────────────────────────
// ホーム: いまの季節の撮影スポット
// ─────────────────────────────────────────────────────────────

/** 月（1〜12）→ 季節（北半球・日本の暦） */
export function seasonOfMonth(month: number): SpotSeason {
    if (month >= 3 && month <= 5) return "spring";
    if (month >= 6 && month <= 8) return "summer";
    if (month >= 9 && month <= 11) return "autumn";
    return "winter";
}

/** 日本時間の年と月 */
function jstYearMonth(now: Date): { year: number; month: number } {
    const j = new Date(now.getTime() + 9 * 3600 * 1000);
    return { year: j.getUTCFullYear(), month: j.getUTCMonth() + 1 };
}

/** 決まった並びを作るための小さなハッシュ（FNV-1a） */
function hash(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
}

export type HomeSeasonSpot = { slug: string; name: string; region: string; src: string; alt: string; credit: TopicCredit | null };
export type HomeSeasonal = { season: SpotSeason; href: string; total: number; spots: HomeSeasonSpot[] };

/**
 * ホームに並べる「いまの季節の撮影スポット」。**ビルドの時点の月（日本時間）で決める。**
 *
 * - その季節の案内（`seasonalGuide`）を持ち、**代表写真がある**公開済みの行だけ
 * - **南半球の行は外す**（日本の月の季節と逆になる。座標の緯度が負の行）
 * - 並びは「スラッグ＋年月」のハッシュ順＝**同じ月のビルドなら同じ顔ぶれ**、月が変わると入れ替わる
 *   （定期ビルドは週1。ビルドの日付で中身が変わるのはこの節だけ）
 */
export function homeSeasonalSpots(now: Date, spots: readonly Spot[] = SPOTS, limit = 6): HomeSeasonal | null {
    const { year, month } = jstYearMonth(now);
    const season = seasonOfMonth(month);
    const pool = topicSpots(spots).filter((s) => hasSeason(s, season) && !(s.coords && s.coords.lat < 0));
    const withCover = pool
        .map((s) => ({ s, card: toTopicCard(s) }))
        .filter((x) => x.card.cover)
        .sort((a, b) => hash(`${a.s.slug}:${year}-${month}`) - hash(`${b.s.slug}:${year}-${month}`) || a.s.slug.localeCompare(b.s.slug));
    if (withCover.length === 0) return null;
    return {
        season,
        href: ROUTES.SPOT_SEASON(season),
        total: topicSpots(spots).filter((s) => hasSeason(s, season)).length,
        spots: withCover.slice(0, limit).map(({ card }) => ({
            slug: card.slug, name: card.name, region: card.region,
            src: card.cover!.src, alt: card.cover!.alt, credit: card.cover!.credit,
        })),
    };
}

// ─────────────────────────────────────────────────────────────
// サイトマップ（`app/sitemap.ts` から1行で呼ぶ・別の枝と衝突を小さくするため関数を分ける）
// ─────────────────────────────────────────────────────────────

type SitemapEntry = { url: string; lastModified: string | Date; changeFrequency: "weekly"; priority: number };

/**
 * 切り口の頁のうち**検索に出すもの**（国は `MIN_INDEXABLE_COUNTRY` 件以上・テーマ・季節は全部）。
 * `lastModified` は**載せたスポットの更新日の最大**（ビルドの時刻にしない）
 */
export function spotTopicSitemapEntries(baseUrl: string = siteConfig.url, spots: readonly Spot[] = SPOTS): SitemapEntry[] {
    const now = new Date().toISOString();
    const entry = (path: string, members: readonly Spot[], priority: number): SitemapEntry => ({
        url: `${baseUrl}${path}`,
        lastModified: latest(members) ?? now,
        changeFrequency: "weekly",
        priority,
    });
    return [
        ...countryTopics(spots).filter((c) => c.spots.length >= MIN_INDEXABLE_COUNTRY).map((c) => entry(ROUTES.SPOT_COUNTRY(c.code), c.spots, 0.6)),
        ...themeTopics(spots).map((t) => entry(themePath(t), t.spots, 0.5)),
        ...seasonTopics(spots).map((t) => entry(seasonPath(t), t.spots, t.area ? 0.5 : 0.6)),
    ];
}

// ─────────────────────────────────────────────────────────────
// 頁の metadata（4つの route で共用）
// ─────────────────────────────────────────────────────────────

/**
 * 題・説明・canonical・robots・OGP。**県の頁（`/spots/area/<x>`）と同じ形。**
 * 検索に出さない頁（1件の国）は `noindex, follow`（リンクは辿らせる）
 */
export function topicMetadata(view: TopicView | null) {
    if (!view) return { robots: { index: false, follow: true } };
    const title = topicTitle(view);
    const description = topicDescription(view);
    const url = `${siteConfig.url}${view.path}`;
    // 代表写真があれば OGP に出す（先頭のカード＝写真のあるものが先）。**元の大きさ**（`ogImage`）
    const og = view.ogImage;
    const image = og ? (og.src.startsWith("http") ? og.src : `${siteConfig.url}${og.src}`) : undefined;
    return {
        title,
        description,
        alternates: { canonical: url },
        robots: pageRobots(view.indexable),
        openGraph: {
            type: "website" as const, url, siteName: siteConfig.name,
            locale: siteConfig.locale.ja, title, description,
            // 写真が無ければサイトの固定の代表画像（2026-10-31 #432。書かないと og:image が出ない）
            images: [image ? { url: image, ...(og?.width && og?.height ? { width: og.width, height: og.height } : {}), alt: view.heading } : shareOgImage()],
        },
        twitter: spotTwitterMeta(title, description, image),
    };
}

/**
 * **X（Twitter）のカード**（2026-10-22）。子が `twitter` を書かないと、レイアウトの値（新着の投稿写真・サイト名の題）が
 * そのまま残り、og:image と別の1枚・別の題になっていた（県・季節の頁で実測）。og:image と同じ1枚を渡す。
 * 画像が無ければサイトの固定の代表画像（`SHARE_IMAGE`・2026-10-31 #432。og:image の落とし先と同じ）
 */
export function spotTwitterMeta(title: string, description: string, image: string | undefined) {
    return { card: "summary_large_image" as const, title, description, images: [image ?? shareImageUrl()], creator: siteConfig.twitterHandle };
}
