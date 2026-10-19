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
