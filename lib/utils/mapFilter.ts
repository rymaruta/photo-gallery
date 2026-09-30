/**
 * 撮影地マップ（/map）の絞り込み。**純関数だけ**を置く。
 *
 * 地図は Leaflet（`window` が要る）なので jsdom では描けない。絞り込みの
 * 規則をここに出しておけば、「打った語で何が残るか」「チップに何が出るか」を
 * 地図を建てずにテストできる（`lib/utils/mapClusters.ts` と同じ理由）。
 *
 * **検索の当たり先は撮影地と題だけ。** モックの欄は「撮影地・都市・スポットを
 * 検索」——場所を探す欄で、説明文・タグ・機材まで当てるホームの検索
 * （`useGallery`）とは目的が違う。あちらの haystack を持ち込むと、
 * 「パリ」と打って**撮影地がパリでない写真**（説明文にパリと書いた別の街の
 * 写真）が地図に残り、地図の上では「そこで撮れる」と読めてしまう。
 */

import type { Photo } from "../data/photos";
import { getLocalized } from "../data/photos";
import { normalizeForSearch, slugify } from "./collections";
import { normalizeSpotName } from "./spots";

/** 地図の表示範囲（Leaflet の `getBounds()` を素の数で受ける） */
export type MapBounds = { south: number; west: number; north: number; east: number };

/** 座標を持つ写真（`PhotoMap` の `MapPhoto` と同じ形。循環 import を避けて再掲） */
type WithCoords = { coords: { lat: number; lng: number } };

/**
 * 検索語に当たるか。撮影地 → 題（ja/en）の順に見る。
 *
 * **両側に同じ正規化をかける。** 生の `includes` だけだと
 * `"フランス ヴェルサイユ".includes("フランス-ヴェルサイユ")` が false になり、
 * 集約ページの404救済（`/location/<スラッグ>` → 検索）から流れてきた
 * ハイフン入りの語が必ず0件になる（`useGallery` が先に踏んだ穴）。
 *
 * **空に落ちる語ではスラッグ比較をしない。** `-` `#` `...` は
 * `normalizeForSearch` が空文字を返し、`includes("")` は常に真——
 * 全件一致で絞り込みが効かなくなる。
 */
export function matchesMapQuery(photo: Photo, query: string, locale: "ja" | "en" = "ja"): boolean {
    const q = (query ?? "").trim().toLowerCase();
    if (!q) return true;
    const location = (photo.location ?? "").toString();
    const titleJa = getLocalized(photo.title, "ja");
    const titleEn = getLocalized(photo.title, "en");
    const haystack = `${location} ${titleJa} ${titleEn}`.toLowerCase();
    if (haystack.includes(q)) return true;
    const qSlug = normalizeForSearch(q);
    if (!qSlug) return false;
    // locale は将来 haystack の並びを変えるときのため（今はどちらの題も入れる）
    void locale;
    return normalizeForSearch(haystack).includes(qSlug);
}

/** カテゴリのチップ1つぶん。`slug` は集約ページと同じ鍵（`/category/<slug>`） */
export type MapCategory = { slug: string; count: number };

/**
 * 地図に載っている写真のカテゴリを、多い順に。
 *
 * **決め打ちで並べない。** モックのチップ（風景・街並み・グルメ・建築・自然）は
 * 絵で、実データに無い種別を出すと押しても0件の欄になる。ここは
 * **いま地図に在る写真のカテゴリだけ**を返す。
 *
 * 鍵は `slugify(_, "category")`——別名表で「建物」と「建築」が同じ
 * `architecture` に畳まれる（集約ページと同じ物差し）。
 */
export function mapCategories(photos: readonly Photo[]): MapCategory[] {
    const counts = new Map<string, number>();
    for (const p of photos) {
        const slug = slugify((p.category ?? "").toString(), "category");
        if (!slug) continue;
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([slug, count]) => ({ slug, count }))
        // 同数の決着まで書く（書かないと Map の挿入順＝入力順という
        // 書いていない規則でチップの並びが決まる）
        .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

/** そのカテゴリの写真か（`mapCategories` と同じ物差しで比べる） */
export function matchesMapCategory(photo: Photo, categorySlug: string): boolean {
    if (!categorySlug || categorySlug === "all") return true;
    return slugify((photo.category ?? "").toString(), "category") === categorySlug;
}

/** 検索語とカテゴリの両方を通す */
export function filterMapPhotos<T extends Photo>(
    photos: readonly T[],
    { query = "", category = "all", locale = "ja" as "ja" | "en" } = {},
): T[] {
    return photos.filter((p) => matchesMapCategory(p, category) && matchesMapQuery(p, query, locale));
}

/**
 * その範囲の中にあるか。
 *
 * **経度は日付変更線をまたぐ形を通す。** Leaflet は `worldCopyJump` で
 * 中心が ±180 を越えうるので、`west > east` のとき（例: west=170・east=-170）は
 * 「170 以上 **または** -170 以下」で見る。素直に `west <= lng <= east` と
 * 書くと、太平洋を見ているときだけ 0 件になる。
 */
export function isInBounds(point: { lat: number; lng: number }, b: MapBounds): boolean {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
    if (point.lat < Math.min(b.south, b.north) || point.lat > Math.max(b.south, b.north)) return false;
    return b.west <= b.east
        ? point.lng >= b.west && point.lng <= b.east
        : point.lng >= b.west || point.lng <= b.east;
}

/**
 * Leaflet の `getBounds()` を、`isInBounds` が読める形に直す。
 *
 * **Leaflet は経度を ±180 に丸めない。** `worldCopyJump` で世界を跨いで
 * 動かすと `west=169 / east=189` のような値が返る。そのまま渡すと
 * `west <= east` の枝に入り、`east > 180` の側にある写真（日付変更線の
 * west 寄り）が落ちる——**太平洋を見ているときだけ 0 件**になる。
 *
 * - 幅が 360 度以上なら世界全部
 * - そうでなければ両端を ±180 に畳む。日付変更線をまたいでいれば
 *   `west > east` になり、`isInBounds` のもう一方の枝が拾う
 */
export function normalizeBounds(b: MapBounds): MapBounds {
    const south = Math.min(b.south, b.north);
    const north = Math.max(b.south, b.north);
    if (!Number.isFinite(b.west) || !Number.isFinite(b.east) || b.east - b.west >= 360) {
        return { south, west: -180, north, east: 180 };
    }
    const wrap = (lng: number) => (lng >= -180 && lng <= 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180);
    return { south, west: wrap(b.west), north, east: wrap(b.east) };
}

/** 表示範囲に入っている写真だけ */
export function photosInBounds<T extends WithCoords>(photos: readonly T[], b: MapBounds | null): T[] {
    if (!b) return [...photos];
    return photos.filter((p) => isInBounds(p.coords, b));
}


/** 地図に立てる公式スポット（`SpotPin` のうち絞り込みが読むところ。循環 import を避けて再掲） */
type MapSpotLike = { slug: string; name: string; region: string; lat: number; lng: number };

/**
 * **公式スポットを、写真と同じ絞り込みで絞る**（2026-09-30 のレビュー）。
 *
 * 以前は語・カテゴリ・「このエリアを検索」が写真だけに効き、スポットの一覧とピンは
 * 全件（1,079件）のまま残っていた——「銀山温泉」と打っても、地図は全国のピンで埋まる。
 *
 *   - **語**: 名前と地域（県・市、海外は国）。正規化は撮影スポットの名前の突き合わせと同じ
 *     （`normalizeSpotName`・全角半角・空白・括弧の揺れを落とす）
 *   - **カテゴリ**: チップは**写真の分類**（風景・建物…）で、台帳の分類（温泉街・神社…）とは
 *     別の持ち物。対応表を作ると嘘の対応が混ざるので、**カテゴリで絞っている間はスポットを
 *     出さない**（画面はそのことを一覧の場所で言う）
 *   - **範囲**: 写真と同じ `isInBounds`
 */
export function filterMapSpots<T extends MapSpotLike>(
    spots: readonly T[],
    {
        query = "", category = "all", area = null as MapBounds | null,
        /** 名前の索引（`searchSpotRows`）で当たった綴り。読み・英語名・別名でも当てるため（届く前は無し） */
        indexMatches = null as ReadonlySet<string> | null,
        /** 選んでいるスポット。**絞り込みで落とさない**（ピンが消えてシートだけ残る、を作らない） */
        keep = null as string | null,
    } = {},
): T[] {
    const q = normalizeSpotName(query);
    return spots.filter((s) => {
        if (keep && s.slug === keep) return true;
        if (category !== "all") return false;
        const hit = !q || normalizeSpotName(s.name).includes(q) || normalizeSpotName(s.region).includes(q)
            || !!indexMatches?.has(s.slug);
        return hit && (!area || isInBounds({ lat: s.lat, lng: s.lng }, area));
    });
}
