import { coordsOf, isCountablePhoto } from "./badges";
import { placeKey, placeOf } from "./trunkPlace";
import type { Photo } from "./types";
import SPOTS_JSON from "./data/camperSpots.json";
import CALENDAR_JSON from "./data/camperCalendar.json";

/**
 * とおまわり号（キャンピングカー）の「要サーバーの部品」の持ち方（2026-10-18 owner 承認の設計案・第2段）。
 *
 * **新しい表・GSI は作らない。** 旅のトランクの2行（`trunk.ts` の `trunk#<uid>`・`trunkledger#<uid>`）に欄を足し、
 * 書くのはトランクの `updateTrunk`（rev 条件の TransactWriteItems）だけ。
 *
 *     trunk#<uid>（持ち物・人に見せうるもの）
 *       camper: {
 *         parts:    [{ id: "wheel.brass_spoke", at: "…Z", by?: "<贈った人の uid>" }]  持っている印（一度きり・消さない）
 *         trips:    12                       配りを通った旅の投稿の数
 *         tripDays: ["2026-10-12", …]        旅の撮影日（新しい順・最新 60）
 *         gifts:    [{ from, part, at }]     受け取った贈り物（新しい順・最大 40。part は届かなかった回は ""）
 *       }
 *     trunkledger#<uid>（歯止めの台帳）
 *       camperVisits:      [{ u, d }]   友達の車を訪ねた（友達×日・最新 300）
 *       camperWood:        [{ u, d }]   薪をくべた（友達×日・最新 300）
 *       camperGiven:       [{ u, d }]   贈った（相手×日・最新 300）
 *       camperTripFriends: [uid]        同じ日に旅をした友達（最大 50）
 *       camperRecountDay:  "YYYY-MM-DD" 数え直した日（1日1回の歯止め）
 *       camperTripLog:     [{ k, a }]   24時間以内に旅の数に足した投稿（取り消し用・`coinLog` と同じ形）
 *
 * **出す順番（設計案 3.1 の ⚠️）**: `serializeRows` は知っている欄しか書かないので、`trunk#` を書く全部の Lambda
 * （trunk・savePhoto・写真の編集・写真の削除の取り消し）がこの欄を知る前に誰かが部品を書くと、古い Lambda の
 * 次の書き込みで消える。だから**段1（この読み書きだけ）を先に本番へ出し、段2 で配り始める**。
 * 段1 の読み方は**形だけを見る**（部品の id が図鑑に在るかは見ない）——段2 で足す部品・欄の中身が、
 * 段1 の Lambda の書き戻しで落ちないように。
 *
 * 2026-10-18 判断（設計案に足したもの）: `camperTripLog`。24時間以内に消した旅の投稿で旅の数を −1 するには、
 * 「その投稿を旅の数に足したか」を覚えておく必要がある（硬貨の `coinLog` と同じ理由・同じ形）。
 */

export type CamperPartGot = { id: string; at: string; by?: string };
export type CamperGift = { from: string; part: string; at: string };
/** 相手（u）× 日本時間の日（d） */
export type CamperMark = { u: string; d: string };
export type CamperTripEntry = { k: string; a: number };

export type CamperDoc = {
    // ─ trunk#（持ち物）
    parts: CamperPartGot[];
    trips: number;
    tripDays: string[];
    gifts: CamperGift[];
    // ─ trunkledger#（台帳）
    visits: CamperMark[];
    wood: CamperMark[];
    given: CamperMark[];
    tripFriends: string[];
    recountDay?: string;
    tripLog: CamperTripEntry[];
};

/** 上限（設計案 3.1。行の大きさの見積もりは `trunk.test.ts` の「いちばん大きい行」で実測） */
export const CAMPER_PARTS_MAX = 64;
export const CAMPER_TRIP_DAYS_MAX = 60;
export const CAMPER_GIFTS_MAX = 40;
export const CAMPER_MARKS_MAX = 300;
export const CAMPER_TRIP_FRIENDS_MAX = 50;
export const CAMPER_TRIP_LOG_MAX = 20;
/** 旅の数の上限（数の欄が壊れて巨大にならないように。20 回で全部届くので十分大きい） */
export const CAMPER_TRIPS_MAX = 100_000;

export const emptyCamper = (): CamperDoc => ({
    parts: [], trips: 0, tripDays: [], gifts: [], visits: [], wood: [], given: [], tripFriends: [], tripLog: [],
});

/** 何も持っていないか（書く形が空になるか） */
export function isEmptyCamper(c: CamperDoc): boolean {
    const z = serializeCamper(c);
    return !z.main && Object.keys(z.ledger).length === 0;
}

const PART_ID_RE = /^[a-z0-9_]{1,32}\.[a-z0-9_]{1,48}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 保存されている uid の形（書くのはサーバーだけ。`#` を持たない・長すぎない） */
const isStoredUid = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64 && !v.includes("#");
const isDay = (v: unknown): v is string => typeof v === "string" && DAY_RE.test(v);
export const isCamperPartId = (v: unknown): v is string => typeof v === "string" && PART_ID_RE.test(v);

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> | undefined =>
    (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

function marks(v: unknown): CamperMark[] {
    return arr(v).map(obj).filter((m): m is Record<string, unknown> => !!m && isStoredUid(m.u) && isDay(m.d))
        .map((m) => ({ u: m.u as string, d: m.d as string })).slice(0, CAMPER_MARKS_MAX);
}

/**
 * 2行の欄を読み直す（形の違う要素は落とす）。`main` は trunk# の `camper`、`ledger` は trunkledger# の行
 * （古い形＝台帳が trunk# の中にある行では trunk# の行そのもの）
 */
export function parseCamper(main: unknown, ledger: Record<string, unknown> | undefined): CamperDoc {
    const m = obj(main) ?? {};
    const lg = ledger ?? {};
    const seen = new Set<string>();
    const parts: CamperPartGot[] = [];
    for (const raw of arr(m.parts)) {
        const p = obj(raw);
        if (!p || !isCamperPartId(p.id) || typeof p.at !== "string" || seen.has(p.id)) continue;
        seen.add(p.id);
        parts.push({ id: p.id, at: p.at, ...(isStoredUid(p.by) ? { by: p.by } : {}) });
    }
    const trips = typeof m.trips === "number" && Number.isInteger(m.trips) && m.trips >= 0 ? Math.min(m.trips, CAMPER_TRIPS_MAX) : 0;
    return {
        parts: parts.slice(0, CAMPER_PARTS_MAX),
        trips,
        tripDays: [...new Set(arr(m.tripDays).filter(isDay))].slice(0, CAMPER_TRIP_DAYS_MAX),
        gifts: arr(m.gifts).map(obj)
            .filter((g): g is Record<string, unknown> => !!g && isStoredUid(g.from) && typeof g.at === "string"
                && (g.part === "" || isCamperPartId(g.part)))
            .map((g) => ({ from: g.from as string, part: g.part as string, at: g.at as string })).slice(0, CAMPER_GIFTS_MAX),
        visits: marks(lg.camperVisits),
        wood: marks(lg.camperWood),
        given: marks(lg.camperGiven),
        tripFriends: [...new Set(arr(lg.camperTripFriends).filter(isStoredUid))].slice(0, CAMPER_TRIP_FRIENDS_MAX),
        ...(isDay(lg.camperRecountDay) ? { recountDay: lg.camperRecountDay } : {}),
        tripLog: arr(lg.camperTripLog).map(obj)
            .filter((e): e is Record<string, unknown> => !!e && typeof e.k === "string" && e.k.length <= 80
                && typeof e.a === "number" && Number.isFinite(e.a))
            .map((e) => ({ k: e.k as string, a: e.a as number })).slice(0, CAMPER_TRIP_LOG_MAX),
    };
}

/**
 * 書く形に分ける。**空の欄は書かない**（キャンピングカーに触れていない人の行は、今までと1バイトも変えない）
 */
export function serializeCamper(c: CamperDoc | undefined): { main?: Record<string, unknown>; ledger: Record<string, unknown> } {
    if (!c) return { ledger: {} };
    const main: Record<string, unknown> = {
        ...(c.parts.length ? { parts: c.parts.slice(0, CAMPER_PARTS_MAX).map((p) => ({ id: p.id, at: p.at, ...(p.by ? { by: p.by } : {}) })) } : {}),
        ...(c.trips > 0 ? { trips: Math.min(c.trips, CAMPER_TRIPS_MAX) } : {}),
        ...(c.tripDays.length ? { tripDays: c.tripDays.slice(0, CAMPER_TRIP_DAYS_MAX) } : {}),
        ...(c.gifts.length ? { gifts: c.gifts.slice(0, CAMPER_GIFTS_MAX) } : {}),
    };
    return {
        ...(Object.keys(main).length ? { main } : {}),
        ledger: {
            ...(c.visits.length ? { camperVisits: c.visits.slice(0, CAMPER_MARKS_MAX) } : {}),
            ...(c.wood.length ? { camperWood: c.wood.slice(0, CAMPER_MARKS_MAX) } : {}),
            ...(c.given.length ? { camperGiven: c.given.slice(0, CAMPER_MARKS_MAX) } : {}),
            ...(c.tripFriends.length ? { camperTripFriends: c.tripFriends.slice(0, CAMPER_TRIP_FRIENDS_MAX) } : {}),
            ...(c.recountDay ? { camperRecountDay: c.recountDay } : {}),
            ...(c.tripLog.length ? { camperTripLog: c.tripLog.slice(0, CAMPER_TRIP_LOG_MAX) } : {}),
        },
    };
}

// ─── 段2: 配る決まり（2026-10-18 owner 承認の設計案 2.1〜2.3・純関数だけ。書くのは `trunk.ts` の `updateTrunk`） ───

/**
 * 配り始める線（`at`）。**これより後に作られた公開の写真・旅だけ**を数える（遡らない・設計案 1）。
 * **null（いま）なら配らない**（口は `launched: false` を返し、投稿の相乗りも何も書かない）。
 *
 * 2026-10-18 判断（見直しの指摘）: 環境変数（serverless の param）にしていたが、`deploy-api.yml` は決まった
 * `--param` しか渡さないので、本番では永久に空のままだった。**`TRUNK_LAUNCHED_AT` と同じくコードに持つ。**
 * 配り始めるときは、ここに ISO の時刻（例 `"2026-11-01T15:00:00.000Z"`）を入れる**小さなコミットを別に出す**
 * （`camper.test.ts` の「いまは null」の試験も一緒に直す）。入れた値は後ろへずらさない（遡って対象外にしない）。
 * 試験だけがこの値を書き換える（そのため定数ではなく箱にしてある）
 *
 * 2026-10-19 判断: owner の許可（TestFlight まで自動で進めてよい）のもとで配り始め。線は 2026-10-19T04:00:00.000Z
 * （日本時間 13:00）。段1・段2 が本番に出たあと（main d1db3385）の時刻で、これより後に作られた公開の写真・旅だけ数える。
 * **この値は動かさない**（後ろへずらすと、その間に撮った写真が遡って対象外になる）
 */
export const CAMPER_LAUNCH: { at: string | null } = { at: "2026-10-19T04:00:00.000Z" };

export function camperLaunchedAt(at: string | null = CAMPER_LAUNCH.at): number | null {
    const raw = (at ?? "").trim();
    if (!raw) return null;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
}

/** 要サーバーの部品 33 個（iOS `CamperCatalog.swift` の `.server`・板 CamperDex の付箋 n_dex_get と同じ） */
export const CAMPER_SPOT_PARTS: Record<string, string | null> = {
    forest: "bumper.wood_beam",
    water: "roof_cargo.canoe",
    harbor: "window_shape.porthole",
    cycling: "bike_rack.rear_two",
    pottery: "mug.ceramic_glazed",
    festival: null, // 祭りは数で見る（下の FESTIVAL_*）
};
/** 行事の種類の数 → 部品（設計案の案: 1・3・6 種類で段にする） */
export const CAMPER_EVENT_TIERS: [number, string][] = [
    [1, "window_shape.arched"], [3, "curtain.beaded"], [6, "sticker_edge.holo"],
];
export const CAMPER_SUMMER_FESTIVAL = "outdoor_light.paper_lantern";
export const CAMPER_FESTIVALS = { count: 5, part: "flag.prayer_line" } as const;
export const CAMPER_RAIN = "tire_tread.mud_block";
export const CAMPER_RAIN_PHOTOS = { count: 5, part: "plant.hanging_ivy" } as const;
export const CAMPER_WIND = "flag.windsock";
/** 旅の投稿の数 → 部品（`CamperCatalog.swift` の数のとおり 12 個） */
export const CAMPER_TRIP_TIERS: [number, string][] = [
    [2, "flag.swallowtail"], [3, "mudflap.checker"], [4, "roof_tent.popup_canvas"], [4, "cushion.tasseled"],
    [5, "grille.honeycomb"], [5, "solar.folding_suitcase"], [6, "spare_cover.hardshell"], [6, "table.wooden_crate_table"],
    [7, "bookshelf.crate_stack"], [8, "bike_rack.folding_bike"], [12, "wall_wood.herringbone"], [20, "wheel.brass_spoke"],
];
/** 違う何人目の贈り物で届くか（設計案の案: 1・2・4・6 人目。1 人目は贈った人の名前を刻む） */
export const CAMPER_GIFT_TIERS: [number, string][] = [
    [1, "sticker_edge.signed"], [2, "mirror.brass_oval"], [4, "rug.kilim"], [6, "awning.rust_stripe"],
];
export const CAMPER_LADDER = { count: 3, part: "ladder.wood_rungs" } as const;
export const CAMPER_WOOD = { count: 10, part: "fire_pit.tripod_kettle" } as const;
export const CAMPER_SAME_DAY = "roof_tent.wing";
/**
 * 「友達 10 人と旅を交わす」。2026-10-18 判断（設計案 2.3 の案どおり）: **同じ日に旅をした友達が 10 人**。
 * 板に意味が書いていないので、`roof_tent.wing` と同じ記録（`tripFriends`）で数える。ランタンを掛け合う・
 * 互いの旅にコメントする、の読みにするなら別の記録が要る（owner の決め）
 */
export const CAMPER_TRIP_FRIENDS = { count: 10, part: "antenna.ham_long" } as const;
/** 贈り物の歯止め（設計案 3.3・4.4 の 4）: 登録から 7 日 */
export const CAMPER_GIFT_MIN_AGE_MS = 7 * 86_400_000;

export const CAMPER_SERVER_PART_IDS: readonly string[] = [
    ...Object.values(CAMPER_SPOT_PARTS).filter((v): v is string => !!v),
    ...CAMPER_EVENT_TIERS.map(([, id]) => id), CAMPER_SUMMER_FESTIVAL, CAMPER_FESTIVALS.part,
    CAMPER_RAIN, CAMPER_RAIN_PHOTOS.part, CAMPER_WIND,
    ...CAMPER_TRIP_TIERS.map(([, id]) => id), ...CAMPER_GIFT_TIERS.map(([, id]) => id),
    CAMPER_LADDER.part, CAMPER_WOOD.part, CAMPER_SAME_DAY, CAMPER_TRIP_FRIENDS.part,
];

// ─── 写真から読む（A の 13 個） ───

/** `scripts/gen-camper-spots.ts` が書く写し（区分の名前・[spotId, 緯度, 経度, 区分のビット]） */
type CamperSpots = { classes: string[]; spots: [string, number, number, number][] };
const SPOTS = SPOTS_JSON as unknown as CamperSpots;
/** 写しの中身（テストが当たるスポットを選ぶのに使う） */
export const camperSpotsForTest = () => SPOTS.spots;
const SPOT_MASK = new Map(SPOTS.spots.map(([id, , , mask]) => [id, mask]));
const SPOT_POINTS = SPOTS.spots.filter(([, lat]) => lat !== 999);
/** スポットを選ばなかった写真は、座標がその点から 2km 以内なら当たる（設計案 2.1） */
export const CAMPER_SPOT_RADIUS_KM = 2;
const classBit = (c: string) => 1 << SPOTS.classes.indexOf(c);

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** その写真が当たるスポットの区分（スポットを選んでいればそれだけ、無ければ座標の近さ） */
export function spotMaskOf(p: Photo): number {
    const id = typeof p.spotId === "string" ? p.spotId : "";
    if (id) return SPOT_MASK.get(id) ?? 0;
    const c = coordsOf(p);
    if (!c) return 0;
    let mask = 0;
    for (const [, lat, lng, m] of SPOT_POINTS) {
        if (Math.abs(lat - c.lat) > 0.05) continue; // 2km ≒ 緯度 0.018 度。先に粗く落とす
        if (km(c, { lat, lng }) <= CAMPER_SPOT_RADIUS_KM) mask |= m;
    }
    return mask;
}

/** 撮影日（その土地の時計の YYYY-MM-DD）。EXIF の撮影日時 → 写真の日付。読めなければ null */
export function shotDayOf(p: Photo): string | null {
    for (const raw of [p.exif?.dateTimeOriginal, p.date]) {
        if (typeof raw !== "string") continue;
        const m = /^(\d{4})[-:/](\d{2})[-:/](\d{2})/.exec(raw.trim());
        if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
    }
    return null;
}

type Calendar = { fixed: Record<string, string[]>; byYear: Record<string, Record<string, string>> };
const CAL = CALENDAR_JSON as unknown as Calendar;

/** その日の行事（`camperCalendar.json`）。無ければ空 */
export function eventsOn(day: string): string[] {
    const md = day.slice(5), y = day.slice(0, 4);
    const out: string[] = [];
    for (const [k, days] of Object.entries(CAL.fixed)) if (days.includes(md)) out.push(k);
    for (const [k, years] of Object.entries(CAL.byYear)) if (years[y] === md) out.push(k);
    return out;
}

/** 題・タグ（・説明）の字を1つに（題・説明は言語ごとの形もある） */
function textOf(p: Photo, withDescription: boolean): string {
    const flat = (v: unknown): string[] => typeof v === "string" ? [v]
        : Array.isArray(v) ? v.flatMap(flat)
            : v && typeof v === "object" ? Object.values(v as Record<string, unknown>).flatMap(flat) : [];
    return [...flat(p.title), ...flat(p.tags), ...(withDescription ? flat(p.description) : [])].join("\n");
}

const FESTIVAL_RE = /祭|\bfestivals?\b/i;
/**
 * 天気は言葉で読む（設計案 2.1 の第一案。WeatherKit は使わない）。2026-10-18 判断: 英語は語の切れ目で見る
 * （train・rainbow・Bahrain に当てない）
 */
const RAIN_RE = /雨|\brain(y|ing|s)?\b/i;
const WIND_RE = /強風|風の強い|風が強い|暴風|突風|\bwindy\b|\bgales?\b|\bstrong winds?\b/i;
/**
 * 言葉を探す前に消す**地名・建物の名前**（2026-10-18 見直しの指摘）。台帳（`content/spots.json`）の名前・別名で
 * 「雨」「祭」を含むのに天気・祭りではないものを拾った: 雨晴海岸・雨滝・雨引観音・雨竜（中津渓谷）と、
 * 葬祭殿（ハトシェプスト女王葬祭殿）・三神合祭殿（出羽三山神社）・祭場（宗像大社の高宮祭場・相馬野馬追の祭場地）。
 * 祭壇・祭神・祭祀も同じ「祭り（行事）ではない祭」なので落とす。地名を足すときはここに足す
 */
const NOT_RAIN_RE = /雨晴|雨滝|雨引|雨竜|雨飾|雨乞/g;
const NOT_FESTIVAL_RE = /葬祭|祭殿|祭場|祭壇|祭神|祭祀/g;

export const isFestivalPhoto = (p: Photo) => (spotMaskOf(p) & classBit("festival")) !== 0
    || FESTIVAL_RE.test(textOf(p, false).replace(NOT_FESTIVAL_RE, ""));
export const isRainPhoto = (p: Photo) => RAIN_RE.test(textOf(p, true).replace(NOT_RAIN_RE, ""));
export const isWindPhoto = (p: Photo) => WIND_RE.test(textOf(p, true));

/** 本人の・公開の（`isCountablePhoto`）・線より後に作られた写真か */
export function isCamperPhoto(p: Photo, uid: string, launchedAt: number): boolean {
    if (!isCountablePhoto(p) || (p.userId ?? p.uploadedBy) !== uid) return false;
    const t = typeof p.createdAt === "string" ? Date.parse(p.createdAt) : NaN;
    return Number.isFinite(t) && t >= launchedAt;
}

/** 1投稿の鍵（束は1投稿。`trunk.ts` の postKey と同じ決まり） */
const postKeyOf = (p: Photo) => {
    const g = typeof p.groupId === "string" ? p.groupId.trim() : "";
    return g ? `g:${g}` : `p:${p.id}`;
};

/**
 * 写真だけで決まる部品（A の 13 個）。`photos` は**判定に使ってよい写真だけ**（`isCamperPhoto` を通したもの）。
 * - スポットの区分 → 1 個ずつ
 * - 行事: 撮影日の行事の**種類**を数える（1・3・6 種類）
 * - 祭り: 祭りの写真で撮影月が 7〜8 月 → 提灯。違う祭りが 5 つ → 連なる旗（同じ祭りは、スポットならスポット、
 *   そうでなければ「撮影地＋撮影日」で1つ。どちらも無ければ投稿で1つ）
 * - 天気（言葉）: 雨 → 泥のブロック・雨の**投稿**が 5 つ → 吊るしたつる（2026-10-18 判断: 束の 5 枚で一度に届かないよう投稿で数える）。強風 → 吹き流し
 */
export function photoParts(photos: Photo[]): Set<string> {
    const out = new Set<string>();
    const events = new Set<string>();
    const festivals = new Set<string>();
    const rainPosts = new Set<string>();
    for (const p of photos) {
        const mask = spotMaskOf(p);
        for (const c of SPOTS.classes) {
            const part = CAMPER_SPOT_PARTS[c];
            if (part && (mask & classBit(c))) out.add(part);
        }
        const day = shotDayOf(p);
        if (day) for (const e of eventsOn(day)) events.add(e);
        if (isFestivalPhoto(p)) {
            const month = day ? Number(day.slice(5, 7)) : 0;
            if (month === 7 || month === 8) out.add(CAMPER_SUMMER_FESTIVAL);
            const spotId = typeof p.spotId === "string" && (mask & classBit("festival")) ? p.spotId : "";
            const place = placeKey(placeOf(p));
            festivals.add(spotId ? `s:${spotId}` : day && place ? `d:${place}|${day}` : postKeyOf(p));
        }
        if (isRainPhoto(p)) { out.add(CAMPER_RAIN); rainPosts.add(postKeyOf(p)); }
        if (isWindPhoto(p)) out.add(CAMPER_WIND);
    }
    for (const [n, id] of CAMPER_EVENT_TIERS) if (events.size >= n) out.add(id);
    if (festivals.size >= CAMPER_FESTIVALS.count) out.add(CAMPER_FESTIVALS.part);
    if (rainPosts.size >= CAMPER_RAIN_PHOTOS.count) out.add(CAMPER_RAIN_PHOTOS.part);
    return out;
}

// ─── 記録から読む（B の 20 個） ───

/** 違う贈り主を古い順に（`gifts` は新しい順に持つ） */
export function giftGivers(c: CamperDoc): string[] {
    const seen: string[] = [];
    for (const g of [...c.gifts].reverse()) if (!seen.includes(g.from)) seen.push(g.from);
    return seen;
}

/** n 人目の贈り物で届く部品（無ければ ""） */
export const giftPartFor = (n: number): string => CAMPER_GIFT_TIERS.find(([k]) => k === n)?.[1] ?? "";

/**
 * 2行の記録だけで決まる部品（旅の数・贈り物・訪問・薪・同じ日の旅）。値は「贈った人」（贈り物の部品だけ）。
 * 取りこぼし（配る書き込みの後で落ちた・数え直し）を拾うため、どの口からも同じ決まりで見る
 */
export function recordParts(c: CamperDoc): Map<string, string | undefined> {
    const out = new Map<string, string | undefined>();
    for (const [n, id] of CAMPER_TRIP_TIERS) if (c.trips >= n) out.set(id, undefined);
    const givers = giftGivers(c);
    for (const [n, id] of CAMPER_GIFT_TIERS) if (givers.length >= n) out.set(id, givers[n - 1]);
    if (c.visits.length >= CAMPER_LADDER.count) out.set(CAMPER_LADDER.part, undefined);
    if (c.wood.length >= CAMPER_WOOD.count) out.set(CAMPER_WOOD.part, undefined);
    if (c.tripFriends.length >= 1) out.set(CAMPER_SAME_DAY, undefined);
    if (c.tripFriends.length >= CAMPER_TRIP_FRIENDS.count) out.set(CAMPER_TRIP_FRIENDS.part, undefined);
    return out;
}

/**
 * 持っていない部品だけ足す（純関数・二重配布しない＝`rewardInto` と同じ「印があれば何もしない」）。
 * 足した順は図鑑の並び（`CAMPER_SERVER_PART_IDS`）。図鑑に無い id は足さない
 */
export function grantParts(
    c: CamperDoc, want: Map<string, string | undefined> | Set<string>, now: Date,
): { camper: CamperDoc; added: string[] } {
    const owned = new Set(c.parts.map((p) => p.id));
    const at = new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString();
    const added: CamperPartGot[] = [];
    for (const id of CAMPER_SERVER_PART_IDS) {
        if (!want.has(id) || owned.has(id)) continue;
        const by = want instanceof Map ? want.get(id) : undefined;
        added.push({ id, at, ...(by ? { by } : {}) });
    }
    if (!added.length) return { camper: c, added: [] };
    // 持ち方は新しい順（同じ時刻に足したものは図鑑の並びの逆）。返す id は図鑑の並び
    return { camper: { ...c, parts: [...[...added].reverse(), ...c.parts] }, added: added.map((p) => p.id) };
}

/** 旅の投稿を1つ数える（配りを通った `trip-` の束・線より後）。旅の日・取り消し用の控えも足す */
export function countTrip(c: CamperDoc, groupKey: string, day: string | null, now: Date): CamperDoc {
    const a = Math.floor(now.getTime() / 1000);
    return {
        ...c,
        trips: c.trips + 1,
        tripDays: day ? [day, ...c.tripDays.filter((d) => d !== day)].sort().reverse().slice(0, CAMPER_TRIP_DAYS_MAX) : c.tripDays,
        tripLog: [{ k: groupKey, a }, ...c.tripLog.filter((e) => now.getTime() - e.a * 1000 <= 24 * 3_600_000)],
    };
}
