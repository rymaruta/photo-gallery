// lib/utils/spotAutoLink.ts
//
// **写真を撮影スポットに自動で結ぶ決まり**（2026-10-31 判断・owner 承認・journey.photo-ios#425）。
//
// owner:「むすびつくようにしたい。手動で整理するのはめんどう」。写真のデータは書き換えず、
// **静的な生成のときに**この決まりで結ぶ（`lib/server/spotAutoLinks.ts`）。決まりを直せば、
// 前の写真にもすぐ効く。結果は小さな表（写真 id → 撮影スポット id・`/app/data/spot-photo-links.json`）
// にして iOS にも配る——**決まりはここ1か所**（Swift に写しを作らない）。
//
// ## 決まり（案 https://claude.ai/artifact/NHrF23fezgz9sAE6qvS6xW の Summary）
//
//   1. 名前: 撮影スポットの正式名（括弧の中を除き 3字以上）が、写真の撮影地・題・説明のどれかにある
//   2. 別名: 撮影地の文字にあるときだけ使う（題・説明には当てない。「リアス海岸」「トンネル」の
//      ような普通の言葉が別名に入っているため）。**地名だけでできた別名は使わない**
//      （台帳の全行から地域の名前を集め、それだけを並べてできている別名を外す・`regionTokens`）
//   3. 距離: 写真と撮影スポットの両方に位置があれば 5km 以内。撮影地が地域の名前だけ
//      （「パリ」「板橋区, 日本」）なら、位置は地域の代表点なので距離は見ない。
//      写真に位置が無いときは、撮影地に書かれた都道府県が撮影スポットの県と食い違わないこと
//   4. 1つだけ: 当てはまる撮影スポットが2つ以上なら結ばない。台帳で2件以上に当たる
//      名前・別名も使わない
//   5. 公開済みの撮影スポットだけ。本人が外した写真（`spotAuto: "off"`）は結ばない。
//      本人が選んだ `spotId` があれば、そちらが先
//
// 本番の 48枚（2026-10-31）で 正しく16・誤り0・結べない2（`__tests__/spotAutoLink.test.ts` が
// 案の表の例を全部持つ）。
//
// ## `linkStates`（`spots.ts`）との関係
//
// あちらは「人が確認した記録」で `spotId` を**書き込む**ための判定で、名前の一致を証拠にしない
// （owner の指示書 6）。こちらは**書き込まない**表示のときの結び。2026-10-31 に owner が
// 「名前の一致を根拠に含める」を、上の決まりの範囲で認めた。書き込む道は今までどおり
// 本人の操作（投稿・編集の `spotId`）と、確認の記録だけ。

import type { Photo } from "../data/photos";
import type { Spot } from "../data/spots";
import { PREFECTURES } from "../data/prefectures";
import { haversineKm } from "./journey";
import { normalizeSpotName } from "./spots";
import { isPublished } from "./spotGuide";

/** 写真と撮影スポットの位置の差の上限（km）。3km だと高屋神社 本宮（3.7km）が外れる */
export const SPOT_AUTO_KM = 5;
/** 名前・別名の最小の字数（括弧の中を除いて数える） */
export const SPOT_AUTO_MIN_CHARS = 3;
/** 本人が「違う場所なので外す」を押した印（写真の行の `spotAuto`） */
export const SPOT_AUTO_OFF = "off";

/**
 * 突き合わせに使う索引。**JSON にしてそのまま配れる形**（投稿画面が `/app/data/spot-match.json`
 * で読む）。サーバーも同じ索引を通す——画面ごとに答えが割れない
 */
export type SpotMatchIndex = {
    v: 1;
    /** 公開済みの撮影スポット。鍵は短く（約 2,700 行） */
    spots: SpotMatchRow[];
    /** 地域の名前（正規化済み）。撮影地が地域だけかを見る */
    regions: string[];
};

export type SpotMatchRow = {
    /** spotId */
    i: string;
    /** 画面に出す正式名（投稿画面の「撮影スポット『◯◯』に結ぶ」） */
    d: string;
    /** 正式名（括弧の中を除き正規化）。3字未満・台帳で2件以上に当たる名前は空 */
    n: string;
    /** 使える別名（正規化済み。地名だけ・3字未満・台帳で2件以上に当たるものは外してある） */
    a?: string[];
    /** 位置 [lat, lng] */
    c?: [number, number];
    /** 都道府県（日本の行だけ） */
    p?: string;
};

/** 括弧の中を落としてから正規化（「オペラ・ガルニエ（パリ）」→「オペラ・ガルニエ」） */
export function matchKey(value?: string): string {
    return normalizeSpotName((value ?? "").replace(/[（(][^（()）]*[）)]/g, ""));
}

/** 地域の名前の語尾（落とした形も地域として数える: 「春日部市」→「春日部」） */
const REGION_SUFFIX = /(都|道|府|県|市|区|町|村|郡)$/;

function addRegion(out: Set<string>, raw?: string): void {
    const v = normalizeSpotName(raw);
    if (v.length < 2) return;
    out.add(v);
    // 「西臼杵郡高千穂町」は郡と町に分ける
    const gun = v.match(/^(.+?郡)(.+)$/);
    if (gun) { addRegion(out, gun[1]); addRegion(out, gun[2]); }
    const bare = v.replace(REGION_SUFFIX, "");
    if (bare !== v && bare.length >= 2) out.add(bare);
}

/** 台帳の全行（下書きも）から地域の名前を集める */
export function regionTokens(spots: readonly Spot[]): Set<string> {
    const out = new Set<string>();
    for (const s of spots) {
        addRegion(out, s.region?.country);
        addRegion(out, s.region?.prefecture);
        addRegion(out, s.region?.city);
    }
    for (const p of PREFECTURES) addRegion(out, p.name);
    return out;
}

/** 文字列が地域の名前だけを並べてできているか（「兵庫県神戸市」「フランスヴェルサイユ」） */
export function isRegionOnly(key: string, regions: ReadonlySet<string>, maxLen = 16): boolean {
    if (!key) return false;
    const ok: boolean[] = new Array(key.length + 1).fill(false);
    ok[0] = true;
    for (let end = 1; end <= key.length; end++) {
        for (let len = 2; len <= Math.min(maxLen, end); len++) {
            if (ok[end - len] && regions.has(key.slice(end - len, end))) { ok[end] = true; break; }
        }
    }
    return ok[key.length];
}

/**
 * 索引を作る（静的な生成で1回）。**公開済みの撮影スポットだけ**を行にする
 * （`isPublished`。下書きを建てる設定でも、下書きには結ばない）
 */
export function buildSpotMatchIndex(spots: readonly Spot[]): SpotMatchIndex {
    const regions = regionTokens(spots);
    const shown = spots.filter(isPublished);
    const draft = shown.map((s) => {
        const n = matchKey(s.name);
        const a = [...new Set((s.aliases ?? []).map(matchKey))]
            .filter((k) => k.length >= SPOT_AUTO_MIN_CHARS && k !== n && !isRegionOnly(k, regions));
        return { s, n: n.length >= SPOT_AUTO_MIN_CHARS ? n : "", a };
    });
    // 台帳で2件以上に当たる名前・別名は使わない（同名異所）
    const owners = new Map<string, Set<string>>();
    for (const d of draft) {
        for (const k of [d.n, ...d.a]) {
            if (!k) continue;
            const set = owners.get(k) ?? new Set<string>();
            set.add(d.s.spotId);
            owners.set(k, set);
        }
    }
    const unique = (k: string) => (owners.get(k)?.size ?? 0) === 1;
    const rows: SpotMatchRow[] = draft.map(({ s, n, a }) => {
        const aliases = a.filter(unique);
        const c = s.coords;
        const pref = s.region?.prefecture && (s.region.country ?? "日本") === "日本" ? s.region.prefecture : undefined;
        return {
            i: s.spotId,
            d: s.name,
            n: n && unique(n) ? n : "",
            ...(aliases.length ? { a: aliases } : {}),
            ...(c && Number.isFinite(c.lat) && Number.isFinite(c.lng) ? { c: [c.lat, c.lng] as [number, number] } : {}),
            ...(pref ? { p: pref } : {}),
        };
    }).filter((r) => r.n || r.a);
    return { v: 1, spots: rows, regions: [...regions].sort() };
}

/** 結びの判定に要る写真の項目 */
export type AutoLinkPhoto = {
    id?: string;
    title?: Photo["title"];
    description?: Photo["description"];
    location?: string;
    coords?: { lat: number; lng: number } | null;
    spotId?: string | null;
    spotAuto?: string | null;
};

function texts(v: unknown): string[] {
    if (typeof v === "string") return [v];
    if (Array.isArray(v)) return v.flatMap(texts);
    if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).flatMap(texts);
    return [];
}

/** 撮影地が地域の名前だけか（「板橋区, 日本」「パリ」）。郵便番号は数えない */
export function locationIsRegionOnly(location: string | undefined, regions: ReadonlySet<string>): boolean {
    const parts = (location ?? "").normalize("NFKC").split(/[,、，/\s]+/)
        .map((t) => t.trim()).filter((t) => t && !/^[〒\d-]+$/.test(t));
    if (parts.length === 0) return false;
    return parts.every((t) => isRegionOnly(normalizeSpotName(t), regions));
}

/** 撮影地に書かれた都道府県（正式な綴りだけ） */
function prefecturesIn(location: string | undefined): string[] {
    const s = (location ?? "").normalize("NFKC");
    return PREFECTURES.map((p) => p.name).filter((name) => s.includes(name));
}

/** 突き合わせ器。索引から1回作り、写真ごとに `match` を呼ぶ */
export type SpotMatcher = { match: (photo: AutoLinkPhoto) => string | null };

export function spotMatcher(index: SpotMatchIndex): SpotMatcher {
    const regions = new Set(index.regions);
    const match = (photo: AutoLinkPhoto): string | null => {
        const loc = normalizeSpotName(photo.location);
        const all = normalizeSpotName([photo.location ?? "", ...texts(photo.title), ...texts(photo.description)].join("\n"));
        if (!all) return null;
        const regionOnly = locationIsRegionOnly(photo.location, regions);
        const prefs = prefecturesIn(photo.location);
        const c = photo.coords && Number.isFinite(photo.coords.lat) && Number.isFinite(photo.coords.lng) ? photo.coords : null;
        let found: string | null = null;
        for (const row of index.spots) {
            const hit = (row.n && all.includes(row.n)) || (loc && row.a?.some((k) => loc.includes(k)));
            if (!hit) continue;
            if (c && row.c) {
                if (!regionOnly && haversineKm(c, { lat: row.c[0], lng: row.c[1] }) > SPOT_AUTO_KM) continue;
            } else if (!c && prefs.length > 0 && !(row.p && prefs.includes(row.p))) {
                continue;
            }
            if (found && found !== row.i) return null; // 2つ以上は結ばない
            found = row.i;
        }
        return found;
    };
    return { match };
}

/**
 * 自動で結ぶ先。**本人が選んだ `spotId` がある・本人が外した写真は `null`**
 * （`spotId` が先・外した写真は結ばない）
 */
export function autoSpotIdFor(matcher: SpotMatcher, photo: AutoLinkPhoto): string | null {
    if (photo.spotId) return null;
    if (photo.spotAuto === SPOT_AUTO_OFF) return null;
    return matcher.match(photo);
}

/**
 * 写真 id → 撮影スポット id の表（**自動の結びだけ**。`spotId` を持つ写真は入れない）。
 * 公開の写真だけ。鍵は id の順（生成の結果を毎回同じ並びにする）
 */
export function autoLinkTable(matcher: SpotMatcher, photos: readonly (AutoLinkPhoto & { id: string; published?: boolean })[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of [...photos].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
        if (p.published === false) continue;
        const id = autoSpotIdFor(matcher, p);
        if (id) out[p.id] = id;
    }
    return out;
}

/** 表示で使う撮影スポット。本人が選んだ `spotId`、無ければ自動の結び */
export function effectiveSpotId(photo: { id: string; spotId?: string | null }, table: Readonly<Record<string, string>>): string | undefined {
    return photo.spotId || table[photo.id] || undefined;
}

/**
 * 撮影スポットの写真（撮影スポットの頁・`SpotGuidePage`）。本人が選んだ `spotId`、無ければ自動の結び。
 * 公開の写真だけ・並びは渡された順。`hasAuto` は自動で結んだ写真を含むか（頁の注記を出す）
 */
export function photosLinkedTo<P extends { id: string; published?: boolean; spotId?: string | null }>(
    photos: readonly P[],
    spotId: string,
    table: Readonly<Record<string, string>>,
): { photos: P[]; hasAuto: boolean } {
    const mine = photos.filter((p) => p.published !== false && effectiveSpotId(p, table) === spotId);
    return { photos: mine, hasAuto: mine.some((p) => !p.spotId) };
}
