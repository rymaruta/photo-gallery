// lib/utils/tripBook.ts
//
// **旅の一冊**（写真を「旅」にまとめる）。iOS の `Core/Text/TripBook.swift`・`TripBookFacts.swift`・
// `TravelDistance.countableTotal` を Web に移したもの（2026-10-21）。**同じ写真から同じ答え**が出るように、
// 規則・並べ方・端の扱いを1つずつ写してある（試験は `__tests__/tripBook.test.ts`。iOS の
// `TripBookTests.swift`・`TripBookGroupsTests.swift` と同じ場面を同じ答えで見張る）。
//
// 規則はたった3つ:
//
// 1. **日が近ければ同じ旅**（`MAX_GAP_DAYS` = 3 日まで空いてよい）
// 2. **2枚以上で一冊**（1枚は旅ではない）
// 3. **題はその旅でいちばん多い撮影地**（同数なら先に出てきた方）
//
// **場所では切らない**（金沢へ行って帰りに福井へ寄った、は1つの旅）。
// **撮影日の無い写真は旅に入れない**（投稿日は「いつ上げたか」で「いつ行ったか」ではない）。
//
// **公開写真の日付と撮影地（と座標・いいねの数）だけから作る。** サーバーは1行も変えていない
// （`GET /photos?userId=` と静的 JSON が持っている項目だけで足りる）。
//
// 日は「その日の UTC 0 時」を**通しの日数**（1970-01-01 からの日）で持つ。撮影日（`2026-05-02`）は
// そう読み、暦の計算は UTC で行う（見る人の時刻帯で期間がずれない）。

import type { Photo } from "../data/photos";
import { haversineKm } from "./journey";

/** 旅にまとめる写真。公開の口が返す `groupId`（1つの投稿にまとめた束）と公開範囲も読む */
export type TripPhoto = Photo & { groupId?: unknown; audience?: unknown };

/** 同じ旅と見なす日の空き（2泊3日の旅で中日に撮らなくても前後がつながる） */
export const MAX_GAP_DAYS = 3;
/** 一冊に要る最小の枚数 */
export const MIN_PHOTOS = 2;
/** 束の一冊（旅の写真から上げた束）の撮影日の幅の上限（iOS の `LibraryTrips.maxDays`） */
export const MAX_GROUP_DAYS = 30;
/** 旅の写真の流れで上げた束の印（iOS の `UploadGrouping.tripPrefix`） */
export const TRIP_GROUP_PREFIX = "trip-";

export type Trip = {
    /** 日付の束は写真の id を「-」でつないだもの、束の一冊は `group#<groupId>` */
    id: string;
    /** いちばん多い撮影地（元の文字のまま）。無ければ空 */
    place: string;
    /** 通しの日数（UTC の暦） */
    start: number;
    end: number;
    /** 旅の進む向き（古い順） */
    photos: TripPhoto[];
    /** 束から作った一冊なら、その `groupId` */
    groupId?: string;
    /** 非公開の写真が入っている（Web の棚は公開写真だけから作るので、ふつうは偽） */
    isPrivate: boolean;
};

// MARK: - 日

const DAY_MS = 86_400_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
/** ISO 8601 の瞬間（時刻と時刻帯まで。iOS の `ISO8601DateFormatter` の `.withInternetDateTime`） */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** "YYYY-MM-DD" を通しの日数に。暦の上に無い日（2月30日）は null */
export function ymdToDay(text: string): number | null {
    const m = YMD.exec(text);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const t = Date.UTC(y, mo - 1, d);
    const u = new Date(t);
    if (u.getUTCFullYear() !== y || u.getUTCMonth() !== mo - 1 || u.getUTCDate() !== d) return null;
    return Math.round(t / DAY_MS);
}

function instantMs(text: unknown): number | null {
    if (typeof text !== "string" || !INSTANT.test(text)) return null;
    const t = Date.parse(text);
    return Number.isFinite(t) ? t : null;
}

/** 瞬間を、その時刻帯の暦日の通しの日数に */
function localDay(ms: number, timeZone?: string): number | null {
    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone, year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(new Date(ms));
        const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
        return ymdToDay(`${get("year")}-${get("month")}-${get("day")}`);
    } catch {
        return null;
    }
}

/** 撮影日（先頭の `YYYY-MM-DD`）を持つか。読み方は `dayOf` と同じ */
export function hasTakenDay(p: Pick<Photo, "date">): boolean {
    return typeof p.date === "string" && ymdToDay(p.date.slice(0, 10)) !== null;
}

/**
 * その写真の日。**撮影日を優先**し、無ければ投稿日時を `timeZone` の暦日に直す
 * （時刻の無い投稿日は書いてある日のまま）。どちらも読めなければ null。
 * 旅に入るのは撮影日を持つ写真だけなので、投稿日時が効くのは同じ日の中の並びくらい
 */
export function dayOf(p: Pick<Photo, "date" | "createdAt">, timeZone?: string): number | null {
    if (typeof p.date === "string") {
        const d = ymdToDay(p.date.slice(0, 10));
        if (d !== null) return d;
    }
    if (typeof p.createdAt === "string") {
        const ms = instantMs(p.createdAt);
        if (ms !== null) return localDay(ms, timeZone);
        return ymdToDay(p.createdAt.slice(0, 10));
    }
    return null;
}

/**
 * 旅の進む向きに並べる。**日で並べ、同じ日の中は投稿の時刻順**、それも同じなら元の並び。
 * 日の決まらない写真は後ろ
 */
export function inOrder<T extends TripPhoto>(photos: ReadonlyArray<T>, timeZone?: string): T[] {
    return photos
        .map((p, i) => ({ p, i, d: dayOf(p, timeZone) ?? Infinity, t: instantMs(p.createdAt) ?? -Infinity }))
        .sort((a, b) => (a.d !== b.d ? a.d - b.d : a.t !== b.t ? a.t - b.t : a.i - b.i))
        .map((x) => x.p);
}

// MARK: - 束ねる

const trimmedText = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** その旅でいちばん多い撮影地。同数なら**先に出てきた方**（旅の始まりの土地を題にする） */
export function mainPlace(photos: ReadonlyArray<Pick<Photo, "location">>): string {
    const counts = new Map<string, number>();
    for (const p of photos) {
        const place = trimmedText(p.location);
        if (!place) continue;
        counts.set(place, (counts.get(place) ?? 0) + 1);
    }
    let best = "";
    let bestCount = 0;
    for (const [place, count] of counts) {
        if (count > bestCount) { best = place; bestCount = count; }
    }
    return best;
}

/** 表紙。**いいねがいちばん多い1枚**、並びが同じなら最初の1枚 */
export function coverOf(trip: Pick<Trip, "photos">): TripPhoto | undefined {
    let best: TripPhoto | undefined;
    for (const p of trip.photos) {
        if (!best || (p.likes ?? 0) > (best.likes ?? 0)) best = p;
    }
    return best;
}

/** 何日間の旅か（同じ日なら1日。暦の日で数える） */
export function tripDays(trip: Pick<Trip, "start" | "end">): number {
    return Math.max(1, trip.end - trip.start + 1);
}

function ownerOf(p: TripPhoto): string {
    // 投稿者の分からない写真は**それだけで1つの束**（身元の分からない写真どうしを同じ人の旅にしない）
    return (typeof p.userId === "string" && p.userId) || (typeof p.uploadedBy === "string" && p.uploadedBy) || `unknown-${p.id}`;
}

function tripsForOnePerson(photos: TripPhoto[], timeZone?: string): Trip[] {
    const dated = inOrder(photos, timeZone)
        .filter(hasTakenDay)
        .map((p) => ({ p, d: dayOf(p, timeZone) as number }));
    const groups: { p: TripPhoto; d: number }[][] = [];
    for (const item of dated) {
        const tail = groups[groups.length - 1];
        const last = tail?.[tail.length - 1];
        if (last && item.d - last.d <= MAX_GAP_DAYS) groups[groups.length - 1].push(item);
        else groups.push([item]);
    }
    return groups.filter((g) => g.length >= MIN_PHOTOS).map((g) => {
        const list = g.map((x) => x.p);
        return {
            id: list.map((p) => p.id).join("-"),
            place: mainPlace(list),
            start: g[0].d,
            end: g[g.length - 1].d,
            photos: list,
            isPrivate: false,
        };
    });
}

/**
 * 日付で束ねた旅（新しい旅が先頭）。**旅は1人のもの**——投稿者ごとに分けてからまとめる
 * （日付だけで束ねると、同じ日に別の人が撮った写真が1つの旅に混ざる）
 */
export function trips(photos: ReadonlyArray<TripPhoto>, timeZone?: string): Trip[] {
    const byUser = new Map<string, TripPhoto[]>();
    for (const p of photos) {
        const key = ownerOf(p);
        const list = byUser.get(key);
        if (list) list.push(p); else byUser.set(key, [p]);
    }
    return [...byUser.values()].flatMap((list) => tripsForOnePerson(list, timeZone))
        .sort((a, b) => b.start - a.start);
}

/** 旅の写真の流れで上げた束か（`trip-` で始まる `groupId`） */
export function isTripGroup(groupId: unknown): boolean {
    return typeof groupId === "string" && groupId.trim().startsWith(TRIP_GROUP_PREFIX);
}

/**
 * 旅の写真から上げた束を一冊にする（持ち主＋`groupId`）。**撮影日のある写真が2枚以上**で、
 * 撮影日の幅が `MAX_GROUP_DAYS` 以内の束だけ
 */
export function groupTrips(photos: ReadonlyArray<TripPhoto>, timeZone?: string): Trip[] {
    const order: string[] = [];
    const buckets = new Map<string, TripPhoto[]>();
    for (const p of photos) {
        if (!isTripGroup(p.groupId) || !hasTakenDay(p)) continue;
        const owner = (typeof p.userId === "string" && p.userId) || (typeof p.uploadedBy === "string" && p.uploadedBy) || "";
        if (!owner) continue; // 持ち主の分からない写真は1枚の束＝一冊にしない
        const key = `group#${owner}#${(p.groupId as string).trim()}`;
        if (!buckets.has(key)) { order.push(key); buckets.set(key, []); }
        buckets.get(key)!.push(p);
    }
    const out: Trip[] = [];
    for (const key of order) {
        const items = buckets.get(key)!;
        if (items.length < MIN_PHOTOS) continue;
        const groupId = (items[0].groupId as string).trim();
        const ordered = inOrder(items, timeZone);
        const days = ordered.map((p) => dayOf(p, timeZone)).filter((d): d is number => d !== null);
        if (days.length === 0) continue;
        const start = Math.min(...days), end = Math.max(...days);
        if (end - start > MAX_GROUP_DAYS) continue;
        out.push({
            id: `group#${groupId}`,
            place: mainPlace(ordered),
            start, end,
            photos: ordered,
            groupId,
            isPrivate: ordered.some((p) => p.published === false),
        });
    }
    return out;
}

/**
 * **旅の棚**（絞り方はここ1か所）。束の一冊と、残りの公開写真を日付で束ねたものを合わせる
 * （期間の新しい順）。一冊になった束の写真は日付の束から抜く（同じ写真を2冊に数えない）
 */
export function shelfTrips(photos: ReadonlyArray<TripPhoto>, timeZone?: string): Trip[] {
    const groups = groupTrips(photos, timeZone);
    const inGroups = new Set(groups.flatMap((t) => t.photos.map((p) => p.id)));
    const dated = trips(photos.filter((p) => p.published !== false && !inGroups.has(p.id)), timeZone);
    return [...groups, ...dated].sort((a, b) => b.start - a.start);
}

/**
 * 人に見せてよい写真（iOS の `PhotoTrip.isPublic`）: 下書きでなく、公開範囲を絞っていない。
 * Web の棚と旅の記録は**誰が見ても同じ数**にするため、本人のページでもこれだけで作る
 */
export function isPublicPhoto(p: TripPhoto): boolean {
    if (p.published === false) return false;
    const raw = typeof p.audience === "string" ? p.audience.trim() : p.audience == null ? "" : "?";
    return raw === "" || raw === "everyone";
}

/** 人のページの旅の棚と旅の記録に使う写真。**ブロックの関係なら何も返さない** */
export function profileTripPhotos<T extends TripPhoto>(photos: ReadonlyArray<T>, blocked: boolean): T[] {
    return blocked ? [] : photos.filter(isPublicPhoto);
}

/** 写真の id から、その写真が入っている一冊を探す（一冊の URL は `?p=<写真の id>`） */
export function findTrip(shelf: ReadonlyArray<Trip>, photoId: string | null | undefined): Trip | null {
    if (!photoId) return null;
    return shelf.find((t) => t.photos.some((p) => p.id === photoId)) ?? null;
}

// MARK: - 文字と数

const pad = (n: number) => String(n).padStart(2, "0");
function ymdOf(day: number): { y: number; m: number; d: number } {
    const u = new Date(day * DAY_MS);
    return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate() };
}

/** 題（「金沢の旅」）。撮影地が無ければ「旅の記録」。`display` で画面に出す形に縮める */
export function tripTitle(trip: Pick<Trip, "place">, isJa = true, display: (s: string) => string = (s) => s): string {
    const place = display(trip.place.trim()).trim();
    if (!place) return isJa ? "旅の記録" : "A trip";
    return isJa ? `${place}の旅` : `Trip to ${place}`;
}

/** 期間（「2026.09.12 — 09.14」）。同じ日なら1つ、年をまたいだら終わりにも年 */
export function dateRange(start: number, end: number): string {
    const s = ymdOf(start), e = ymdOf(end);
    const first = `${s.y}.${pad(s.m)}.${pad(s.d)}`;
    if (start === end) return first;
    return `${first} — ${s.y === e.y ? "" : `${e.y}.`}${pad(e.m)}.${pad(e.d)}`;
}

/** 日の段の日付（「09.12」） */
export function monthDay(day: number): string {
    const v = ymdOf(day);
    return `${pad(v.m)}.${pad(v.d)}`;
}

/** 「3日間」（英語は1日だけ単数） */
export function daysLabel(days: number, isJa = true): string {
    return isJa ? `${days}日間` : days === 1 ? "1 day" : `${days} days`;
}

/** 「12枚」 */
export function photoCountLabel(count: number, isJa = true): string {
    return isJa ? `${count}枚` : count === 1 ? "1 photo" : `${count} photos`;
}

/** 棚の札の下の1行（「2026.09.12 — 09.14 · 3日間 · 24枚」） */
export function tripLine(trip: Trip, isJa = true): string {
    return `${dateRange(trip.start, trip.end)} · ${daysLabel(tripDays(trip), isJa)} · ${photoCountLabel(trip.photos.length, isJa)}`;
}

/** 撮影地の数（同じ名前は1つ・前後の空白は無視） */
export function placeCount(photos: ReadonlyArray<Pick<Photo, "location">>): number {
    return new Set(photos.map((p) => trimmedText(p.location)).filter(Boolean)).size;
}

function hasCoords(p: TripPhoto): p is TripPhoto & { coords: { lat: number; lng: number } } {
    return !!p.coords && Number.isFinite(p.coords.lat) && Number.isFinite(p.coords.lng);
}

/**
 * 移動（直線・km）。**旅の一冊と同じ並び**で座標をつなぐ。座標と日のある写真が2枚未満なら null
 * （0 km＝同じ場所で2枚、と「数えられない」を混ぜない）
 */
export function tripDistanceKm(photos: ReadonlyArray<TripPhoto>, timeZone?: string): number | null {
    const points = inOrder(photos, timeZone).filter((p) => hasCoords(p) && dayOf(p, timeZone) !== null);
    if (points.length < 2) return null;
    let total = 0;
    for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1].coords!, points[i].coords!);
    return total;
}

/** 移動の数字（3桁区切り）。数えられなければ「—」 */
export function distanceText(km: number | null): string {
    return km === null ? "—" : Math.round(km).toLocaleString("en-US");
}

export type TripDay = { number: number; day: number; place: string; photos: TripPhoto[] };

/** 日ごとの段（DAY 1 / 09.12）。**撮っていない日は段を作らない** */
export function daysOf(trip: Trip, timeZone?: string): TripDay[] {
    const out: TripDay[] = [];
    for (const p of trip.photos) {
        const day = dayOf(p, timeZone) ?? trip.start;
        const number = day - trip.start + 1;
        const last = out[out.length - 1];
        if (last && last.number === number) last.photos.push(p);
        else out.push({ number, day, place: "", photos: [p] });
    }
    for (const d of out) d.place = mainPlace(d.photos);
    return out;
}

export type RouteStop = { day: number; place: string };

/** ルート図の点。通った順に、**同じ場所が続いたらまとめる**。2か所未満なら空 */
export function routeStops(trip: Trip, timeZone?: string): RouteStop[] {
    const stops: RouteStop[] = [];
    for (const p of trip.photos) {
        const place = trimmedText(p.location);
        if (!place || stops[stops.length - 1]?.place === place) continue;
        stops.push({ day: (dayOf(p, timeZone) ?? trip.start) - trip.start + 1, place });
    }
    return stops.length >= 2 ? stops : [];
}

/**
 * 図に載せる点を `limit` 個まで間引く。**最初と最後は必ず残す**。間引いたあとに隣の同名を
 * まとめ（終点の並びは最後の1つを残す）、2か所未満になったら空
 */
export function sampledStops(stops: ReadonlyArray<RouteStop>, limit = 4): RouteStop[] {
    if (stops.length <= limit || limit < 2) return [...stops];
    const last = stops.length - 1;
    const picked = Array.from({ length: limit }, (_, i) => stops[Math.round((i * last) / (limit - 1))]);
    const result: RouteStop[] = [];
    picked.forEach((stop, i) => {
        if (result[result.length - 1]?.place === stop.place) {
            if (i === picked.length - 1 && result.length >= 2) result[result.length - 1] = stop;
            return;
        }
        result.push(stop);
    });
    return result.length >= 2 ? result : [];
}

/** 共有で配る文（題・期間・日数・枚数）。URL は共有の口が別に添える */
export function shareText(trip: Trip, isJa = true, display?: (s: string) => string): string {
    return `${tripTitle(trip, isJa, display)}\n${dateRange(trip.start, trip.end)} · ${daysLabel(tripDays(trip), isJa)} · ${photoCountLabel(trip.photos.length, isJa)}`;
}

/** 一冊の URL（静的書き出しで作れるクエリの形）。写真の id で一冊を指す（増えても同じ一冊に着く） */
export function tripBookPath(userId: string, trip: Pick<Trip, "photos">): string {
    const first = trip.photos[0]?.id ?? "";
    return `/users/trip?id=${encodeURIComponent(userId)}&p=${encodeURIComponent(first)}`;
}
