// lib/data/prefectures.ts
//
// **都道府県の表。** `content/spots.json` の `region.prefecture` に書く名前と、
// URL に使うスラッグ（ローマ字）・地方の対応を1か所に持つ。
//
// ## なぜ要るのか
//
// 🔴 `/spots` に全件を並べると、**索引そのものが重くなる**。実測（2026-09-24）で
// 1件あたり 1,809 バイトなので、目標の「各県30件」（約1,410件）まで伸ばすと
// 索引だけで**約2.4MB**。`scripts/deploy-static-site.js` は HTML を
// `no-cache, no-store` で配る（`isHtmlOrTxt`）ので、**訪問のたびに**落ちる。
//
// だから `/spots` は**都道府県の一覧**にし、スポットの一覧は
// `/spots/area/<スラッグ>` に分ける。1ページあたり30件なら約55KB で収まる。
//
// ## 検索での面積
//
// おまけではなく本題でもある——`CLAUDE.md` の「集約ページを厚くして検索に
// 出せるようにすること」がそのまま当てはまる。「北海道 撮影スポット」のような
// 語で着地できるページが47枚増える。
//
// ⚠️ **名前は台帳の綴りと1字でも違ってはいけない。** 違うと `byPrefecture` が
// 拾えず、そのスポットがどの県のページにも出なくなる。見張りは
// `lib/data/__tests__/spotsLedger.test.ts`（台帳側）と
// `lib/data/__tests__/prefectures.test.ts`（この表そのもの）。

/** 地方。並び順はこの配列のとおり（北から南） */
export const REGIONS = [
    "北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州・沖縄",
] as const;
export type RegionName = (typeof REGIONS)[number];

export const REGION_EN: Record<RegionName, string> = {
    "北海道": "Hokkaido",
    "東北": "Tohoku",
    "関東": "Kanto",
    "中部": "Chubu",
    "近畿": "Kansai",
    "中国": "Chugoku",
    "四国": "Shikoku",
    "九州・沖縄": "Kyushu & Okinawa",
};

export type Prefecture = {
    /** 台帳（`content/spots.json`）の `region.prefecture` と**完全に同じ綴り** */
    name: string;
    /** URL に使う。`/spots/area/<slug>` */
    slug: string;
    nameEn: string;
    region: RegionName;
};

/**
 * 47都道府県。**JIS の順（北から南）** で並べる。
 * `slug` はローマ字（長音は伸ばさない綴り——`hyogo`・`oita`・`kochi`）。
 */
export const PREFECTURES: Prefecture[] = [
    { name: "北海道", slug: "hokkaido", nameEn: "Hokkaido", region: "北海道" },
    { name: "青森県", slug: "aomori", nameEn: "Aomori", region: "東北" },
    { name: "岩手県", slug: "iwate", nameEn: "Iwate", region: "東北" },
    { name: "宮城県", slug: "miyagi", nameEn: "Miyagi", region: "東北" },
    { name: "秋田県", slug: "akita", nameEn: "Akita", region: "東北" },
    { name: "山形県", slug: "yamagata", nameEn: "Yamagata", region: "東北" },
    { name: "福島県", slug: "fukushima", nameEn: "Fukushima", region: "東北" },
    { name: "茨城県", slug: "ibaraki", nameEn: "Ibaraki", region: "関東" },
    { name: "栃木県", slug: "tochigi", nameEn: "Tochigi", region: "関東" },
    { name: "群馬県", slug: "gunma", nameEn: "Gunma", region: "関東" },
    { name: "埼玉県", slug: "saitama", nameEn: "Saitama", region: "関東" },
    { name: "千葉県", slug: "chiba", nameEn: "Chiba", region: "関東" },
    { name: "東京都", slug: "tokyo", nameEn: "Tokyo", region: "関東" },
    { name: "神奈川県", slug: "kanagawa", nameEn: "Kanagawa", region: "関東" },
    { name: "新潟県", slug: "niigata", nameEn: "Niigata", region: "中部" },
    { name: "富山県", slug: "toyama", nameEn: "Toyama", region: "中部" },
    { name: "石川県", slug: "ishikawa", nameEn: "Ishikawa", region: "中部" },
    { name: "福井県", slug: "fukui", nameEn: "Fukui", region: "中部" },
    { name: "山梨県", slug: "yamanashi", nameEn: "Yamanashi", region: "中部" },
    { name: "長野県", slug: "nagano", nameEn: "Nagano", region: "中部" },
    { name: "岐阜県", slug: "gifu", nameEn: "Gifu", region: "中部" },
    { name: "静岡県", slug: "shizuoka", nameEn: "Shizuoka", region: "中部" },
    { name: "愛知県", slug: "aichi", nameEn: "Aichi", region: "中部" },
    { name: "三重県", slug: "mie", nameEn: "Mie", region: "近畿" },
    { name: "滋賀県", slug: "shiga", nameEn: "Shiga", region: "近畿" },
    { name: "京都府", slug: "kyoto", nameEn: "Kyoto", region: "近畿" },
    { name: "大阪府", slug: "osaka", nameEn: "Osaka", region: "近畿" },
    { name: "兵庫県", slug: "hyogo", nameEn: "Hyogo", region: "近畿" },
    { name: "奈良県", slug: "nara", nameEn: "Nara", region: "近畿" },
    { name: "和歌山県", slug: "wakayama", nameEn: "Wakayama", region: "近畿" },
    { name: "鳥取県", slug: "tottori", nameEn: "Tottori", region: "中国" },
    { name: "島根県", slug: "shimane", nameEn: "Shimane", region: "中国" },
    { name: "岡山県", slug: "okayama", nameEn: "Okayama", region: "中国" },
    { name: "広島県", slug: "hiroshima", nameEn: "Hiroshima", region: "中国" },
    { name: "山口県", slug: "yamaguchi", nameEn: "Yamaguchi", region: "中国" },
    { name: "徳島県", slug: "tokushima", nameEn: "Tokushima", region: "四国" },
    { name: "香川県", slug: "kagawa", nameEn: "Kagawa", region: "四国" },
    { name: "愛媛県", slug: "ehime", nameEn: "Ehime", region: "四国" },
    { name: "高知県", slug: "kochi", nameEn: "Kochi", region: "四国" },
    { name: "福岡県", slug: "fukuoka", nameEn: "Fukuoka", region: "九州・沖縄" },
    { name: "佐賀県", slug: "saga", nameEn: "Saga", region: "九州・沖縄" },
    { name: "長崎県", slug: "nagasaki", nameEn: "Nagasaki", region: "九州・沖縄" },
    { name: "熊本県", slug: "kumamoto", nameEn: "Kumamoto", region: "九州・沖縄" },
    { name: "大分県", slug: "oita", nameEn: "Oita", region: "九州・沖縄" },
    { name: "宮崎県", slug: "miyazaki", nameEn: "Miyazaki", region: "九州・沖縄" },
    { name: "鹿児島県", slug: "kagoshima", nameEn: "Kagoshima", region: "九州・沖縄" },
    { name: "沖縄県", slug: "okinawa", nameEn: "Okinawa", region: "九州・沖縄" },
];

/**
 * **海外のスポットの置き場。**
 *
 * 国ごとに分けるほどの数が無い（2026-09-24 時点で4件）。増えたら国で割る。
 * ここを都道府県と同じ `area` の下に置くのは、URL の形を1つに保つため。
 */
export const OVERSEAS_SLUG = "overseas";
export const OVERSEAS_NAME = "海外";
export const OVERSEAS_NAME_EN = "Outside Japan";

const BY_SLUG = new Map(PREFECTURES.map((p) => [p.slug, p]));
const BY_NAME = new Map(PREFECTURES.map((p) => [p.name, p]));

export function prefectureBySlug(slug: string): Prefecture | null {
    return BY_SLUG.get(slug) ?? null;
}

export function prefectureByName(name: string | undefined | null): Prefecture | null {
    return name ? (BY_NAME.get(name) ?? null) : null;
}
