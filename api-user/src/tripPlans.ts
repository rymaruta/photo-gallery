import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { randomUUID } from "crypto";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { updateUserList, readUserRows, UserListError } from "./userList";
import { sanitizeText, sanitizeSpotId } from "./sanitize";

/**
 * 旅行プラン——**行きたい場所を「いつ・どの順で回るか」に並べる**口。
 *
 * 計画書（`docs/journey-photo-plan-2026-09-23.md` 第12章）が決めた形を、
 * そのまま実装する。**足していないもの**もあちらが名指ししている:
 * 移動時間・費用・経路最適化・AI 生成・予約は**作らない**
 * （計算していない数字を出さない、が理由）。
 *
 * ## 入れ物は `spots#<uid>` / `likes#<uid>` と同じ「利用者ごとの1行」
 *
 * このテーブルにソートキーは無いので `trip#<planId>#<uid>` のような行を
 * 前方一致で列挙できない（全表 Scan しか手が無い）。だから
 * `userList.ts` の `updateUserList`（新しい順のリスト1行 ＋ `rev` の CAS）を
 * そのまま使う。**GSI は要らない。**
 *
 * 中身が文字列ではなくオブジェクトなので、`updateUserList` を型引数つきに
 * 広げ、読む側は `readUserRows` を足した——**2つ目の実装は作らない**
 * （`userList.ts` 自身が「規則を2つ書くと静かにずれる」と書いている）。
 *
 * ## 他人のプランは読めない
 *
 * 行 ID は **JWT の `sub` からしか作らない**（`tripsId(getUserId(event))`）。
 * パスにもクエリにも本文にも「誰のプランか」を受け取る口を持たない。
 * `visibility` も**受け取らない**——`"private"` を書き込むだけ。公開できる
 * ようにするかは別の判断で、受け取る口を先に開けておくと、画面が付く前に
 * 「本文に `visibility: "public"` を書けば公開になる」状態が生まれる。
 *
 * ## 上限は「黙って落とす」ではなく「断る」
 *
 * いいね・フォローの一覧は溢れたぶんを古い方から落としてよい（判定は
 * マーカーが持つ・表示用の索引だから）。**プランは利用者自身が書いた
 * 中身で、落ちたら戻せない。** だから `updateUserList` の `max` に任せず、
 * 中で数えて**断る**（`highlights.ts` が同じ形で 403 を返している）。
 *
 * ## 行の大きさも先に見る（**構造の上限だけでは足りない**）
 *
 * DynamoDB の1項目は 400KB。最初は「1人50プラン・1プラン60日・1日30項目」
 * だけを上限にしていたが、**その積は行の予算をはるかに超える**。実測:
 *
 *     項目1つ（スラッグ200B ＋ ひとこと200字）  839 バイト
 *     60日 × 30項目 ＝ 1,800項目                **1,475 KB**  ← 1プランで超える
 *     行の予算                                     350 KB
 *
 * ＝**上限いっぱいまで書いたプランは1つも保存できない**。しかも断り文は
 * 「これ以上は保存できません」だけなので、**どの上限に当たったのか分からない**。
 * テストを書いて初めて出た（`日数・1日の項目数・ひとことを上限で切る` が
 * 403 で落ちた）。
 *
 * だから天井を2段にする:
 *
 *   1プランごと  `TRIP_PLAN_BUDGET_BYTES`  … 「この旅程はこれ以上増やせません」
 *   行ぜんぶ      `TRIPS_BUDGET_BYTES`      … 「プランを減らしてください」
 *
 * **構造の上限（日数・項目数・字数）は目安**で、本当の天井はバイト数。
 * 構造の上限を残すのは、1回の要求で処理する量を抑えるためと、
 * 断る理由を具体的に言うため。
 *
 * `comments.ts` が同じ理由で `overBudgetCount` を持っているが、あちらは
 * 古い方から落とす。**ここは断る**（上と同じ——利用者が書いた中身だから）。
 */

/** 旅行プランの一覧（`trips#<uid>`）。新しい順 */
const tripsId = (uid: string) => `trips#${uid}`;

/** 1人が持てるプランの数。**超えたら断る**（古い方を落とさない） */
export const TRIPS_MAX = 50;
/** プランの題 */
export const TRIP_TITLE_MAX = 100;
/** 1プランの日数。2か月の旅まで */
export const TRIP_DAYS_MAX = 60;
/** 1日に置ける項目。1日20か所は実際の旅より十分多い */
export const TRIP_ITEMS_PER_DAY_MAX = 20;
/** 項目に添えるひとこと */
export const TRIP_NOTE_MAX = 200;
/**
 * 行1つの予算（バイト）。400KB に対して 50KB の余白
 * （`id`・`uid`・`rev`・`updatedAt` と、DynamoDB が属性名ぶんに使う分）。
 * `comments.ts` の `ITEM_BUDGET_BYTES` と同じ取り方。
 */
export const TRIPS_BUDGET_BYTES = 350 * 1024;
/**
 * **1プランの予算**（バイト）。
 *
 * 数え方（実測・2026-09-24）:
 *
 *     項目1つ  ひとこと無し・短いスラッグ      30 B
 *              スラッグ200B ＋ ひとこと200字  839 B
 *     60日 × 20項目 ＝ 1,200項目  素で 35 KB ／ 全部最大なら 983 KB
 *
 * ＝**構造の上限まで置いても、ふつうに書くぶんには 35KB で収まる**。
 * 128KB はそこに3倍以上の余裕を見た値で、**ひとことを全部の項目に
 * 200字ずつ書いた場合だけ**当たる（そのときは「この旅程は…」と断る）。
 *
 * 行の予算（350KB）より大きいのは意図的——「1つを大きく」と
 * 「たくさん並べる」で当たる天井を分け、断り文を言い分けるため。
 */
export const TRIP_PLAN_BUDGET_BYTES = 128 * 1024;

/**
 * 撮影スポットの ID の形（`content/spots.json` の `spotId`）。
 *
 * **実在は確かめない。** 台帳は `content/` の JSON で、Lambda に持ち込むと
 * 全文がバンドルに乗る（`lib/data/spotLink.ts` が同じ理由でクライアントから
 * 外している）。`savedSpots.ts` がスラッグの**形**しか見ないのと同じ立場
 * ——実在しない ID を入れても、画面が出すときに解けずに落ちるだけ。
 */
const isSpotId = (x: string) => sanitizeSpotId(x) === x;

/** 撮影地スラッグの上限（**バイト**）。`savedSpots.ts` と同じ理由・同じ値 */
const MAX_SLUG_BYTES = 200;
const isLocationSlug = (x: string) =>
    x.length > 0 && !x.includes("#") && Buffer.byteLength(x, "utf8") <= MAX_SLUG_BYTES;

/**
 * 旅の日付。**`sanitize.ts` の `sanitizeDate` は使えない。**
 *
 * あちらは**撮影日**用で「1990年より前」と「未来」を捨てる。旅行プランは
 * **これから行く日**を書くものなので、未来を捨てると使えない。
 * 受けるのは `YYYY-MM-DD` だけ（計画書が「ISO の日付だけ」と決めている）。
 * 実在しない日（2月30日）も弾く——`Date` は繰り上げて通してしまう。
 */
export function sanitizeTripDate(v: unknown): string | undefined {
    if (typeof v !== "string") return undefined;
    const s = v.trim();
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return undefined;
    /**
     * **書き戻して一致するものだけ通す。** これが形の検査も兼ねる
     * ——`toISOString()` が返すのは必ず `YYYY-MM-DD...` なので、
     * 一致するなら `s` は `YYYY-MM-DD` そのもの。繰り上がり
     * （`2024-02-30` → 3/1）も、`2026/05/01` のような別の書き方も、
     * ここで落ちる。
     *
     * ⚠️ **`/^\d{4}-\d{2}-\d{2}$/` を先に置いていたが、外しても
     * 14通りの入力で答えが1つも変わらなかった**（実測）。上の理由で
     * 論理的にも冗長なので落とした（`bf3df612`「二重の守りは1本にする」）。
     * 足し直さないこと——足すと、この行を壊す変異が観測できなくなる。
     */
    return d.toISOString().slice(0, 10) === s ? s : undefined;
}

export type TripItem =
    | { kind: "spot"; spotId: string; note?: string }
    | { kind: "location"; slug: string; note?: string };

export type TripDay = { date?: string; items: TripItem[] };

export type TripPlan = {
    /** **題から作らない**（改名で別物になる・他人が当てられる）。`spots.ts` と同じ判断 */
    planId: string;
    ownerId: string;
    title: string;
    startDate?: string;
    endDate?: string;
    days: TripDay[];
    /** **いまは非公開だけ**。受け取らず、ここが書く */
    visibility: "private";
    createdAt: string;
    updatedAt: string;
};

/**
 * `updateUserList` に**切らせない**ための値。
 *
 * あちらの `max` は「溢れたぶんを古い方から落とす」ための枠で、いいね・
 * フォローの一覧にはそれが正しい（判定はマーカーが持つ・索引だから）。
 * ここで `TRIPS_MAX` を渡すと、**上限を後から下げた日に、消す操作ひとつで
 * 溢れているぶんのプランが黙って消える**——利用者が書いた中身なので
 * 戻せない。数を見るのは `mutate` の1か所だけにする。
 */
const NO_TRUNCATE = Number.MAX_SAFE_INTEGER;

/** 上限を超えたときに一覧の書き込みから抜ける印（`updateUserList` は CCF 以外を素通しする） */
class TripLimitError extends Error {
    constructor(readonly reason: string) { super(reason); }
}

/** 保存されている行として通してよい形（読むとき・消すとき） */
export function isStoredTripPlan(x: unknown): x is TripPlan {
    if (typeof x !== "object" || x === null) return false;
    const p = x as Partial<TripPlan>;
    // **`days` の中までは見ない。** 上限を後から狭めたときに、
    // 既に入っているプランが「読めない／消せない」になる（`savedSpots.ts` の
    // 「長さを見ない」と同じ三すくみ）。形の芯だけ見る
    return typeof p.planId === "string" && p.planId.length > 0
        && typeof p.title === "string"
        && Array.isArray(p.days);
}

/** 受け取った項目を、保存してよい形に均す。読めなければ `null`（その項目だけ落とす） */
function sanitizeItem(raw: unknown): TripItem | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as { kind?: unknown; spotId?: unknown; slug?: unknown; note?: unknown };
    const note = sanitizeText(r.note, TRIP_NOTE_MAX);
    if (r.kind === "spot") {
        const spotId = typeof r.spotId === "string" ? r.spotId.trim() : "";
        if (!isSpotId(spotId)) return null;
        return note ? { kind: "spot", spotId, note } : { kind: "spot", spotId };
    }
    if (r.kind === "location") {
        const slug = typeof r.slug === "string" ? r.slug.trim() : "";
        if (!isLocationSlug(slug)) return null;
        return note ? { kind: "location", slug, note } : { kind: "location", slug };
    }
    // **知らない種別は落とす。** 通すと、画面が描けない項目が枠を食ったまま残る
    return null;
}

/** 受け取った日ごとの並びを均す */
function sanitizeDays(raw: unknown): TripDay[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, TRIP_DAYS_MAX).map((d) => {
        const rd = (typeof d === "object" && d !== null ? d : {}) as { date?: unknown; items?: unknown };
        const items = Array.isArray(rd.items)
            ? rd.items.map(sanitizeItem).filter((x): x is TripItem => x !== null).slice(0, TRIP_ITEMS_PER_DAY_MAX)
            : [];
        const date = sanitizeTripDate(rd.date);
        return date ? { date, items } : { items };
    });
}

/** 行ぜんぶの予算に収まるか。**足す前に見る**（入らない行を作らない） */
export function fitsBudget(list: readonly TripPlan[]): boolean {
    return Buffer.byteLength(JSON.stringify(list), "utf8") <= TRIPS_BUDGET_BYTES;
}

/** 1プランの予算に収まるか。**先にこちらを見る**（断る理由を具体的にするため） */
export function fitsPlanBudget(plan: TripPlan): boolean {
    return Buffer.byteLength(JSON.stringify(plan), "utf8") <= TRIP_PLAN_BUDGET_BYTES;
}

/** 断り文。**どちらの天井に当たったかを言い分ける** */
const PLAN_TOO_BIG = "この旅程はこれ以上増やせません。項目かひとことを減らしてください";
const ROW_TOO_BIG = "これ以上は保存できません。使わないプランを消してください";

/**
 * GET /user/trips — 自分の旅行プラン（新しい順）。
 *
 * **中身をそのまま返す。** スポットの名前・写真は画面が既に持っている
 * 台帳（`content/spots.json`）から解く（`getMySavedSpots` が
 * 「スラッグだけ返す」としているのと同じ立場）。
 */
export const getMyTrips: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    try {
        const plans = await readUserRows(tripsId(userId), isStoredTripPlan, `trips#${userId}`);
        return {
            statusCode: 200,
            // **本人だけの答え。共有キャッシュには載せない**
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ plans }),
        };
    } catch (e) {
        console.error("getMyTrips error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

/** 本文を読む。壊れていれば `null` */
function parseBody(event: { body?: string | null }): Record<string, unknown> | null {
    try {
        const v = JSON.parse(event.body ?? "{}") as unknown;
        return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/** POST /user/trips — プランを作る */
export const createTrip: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    const body = parseBody(event);
    if (!body) return jsonError(400, "不正なリクエスト");

    const title = sanitizeText(body.title, TRIP_TITLE_MAX);
    if (!title) return jsonError(400, "タイトルを入力してください");

    const now = new Date().toISOString();
    const plan: TripPlan = {
        planId: randomUUID(),
        ownerId: userId,
        title,
        ...dateFields(body),
        days: sanitizeDays(body.days),
        visibility: "private",
        createdAt: now,
        updatedAt: now,
    };

    return writeTrips(userId, "作成に失敗しました", (list) => {
        if (list.length >= TRIPS_MAX) {
            throw new TripLimitError(`旅行プランは${TRIPS_MAX}個までです。使わないものを消してください`);
        }
        if (!fitsPlanBudget(plan)) throw new TripLimitError(PLAN_TOO_BIG);
        const next = [plan, ...list];
        if (!fitsBudget(next)) throw new TripLimitError(ROW_TOO_BIG);
        return next;
    });
};

/**
 * PUT /user/trips/{planId} — プランを置き換える。
 *
 * **送られた項目だけを差し替える**（`/user/edit` と同じ）。`days` を
 * 送らなければ日程は触らない——全置換にすると、題だけ直す画面が
 * 日程を丸ごと消しうる。
 */
export const updateTrip: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    const planId = event.pathParameters?.planId ?? "";
    if (!planId) return jsonError(400, "プランの指定が不正です");
    const body = parseBody(event);
    if (!body) return jsonError(400, "不正なリクエスト");

    // **題は「送ってきたのに読めない」を黙って通さない。**
    // 送っていない（`undefined`）ときだけ触らない
    if ("title" in body && !sanitizeText(body.title, TRIP_TITLE_MAX)) {
        return jsonError(400, "タイトルを入力してください");
    }

    // **やり直し（CCF）のたびに見直す。** 立てっぱなしにすると、1回目に
    // 在って2回目に消えたプランへ 200 を返す
    let found = false;
    const res = await writeTrips(userId, "保存に失敗しました", (list) => {
        const i = list.findIndex((p) => p.planId === planId);
        if (i < 0) { found = false; return null; }
        found = true;
        const prev = list[i];
        const next: TripPlan = {
            ...prev,
            ...( "title" in body ? { title: sanitizeText(body.title, TRIP_TITLE_MAX)! } : {}),
            ...dateFields(body, prev),
            ...( "days" in body ? { days: sanitizeDays(body.days) } : {}),
            // **持ち主と公開範囲は本文から動かさない**
            ownerId: prev.ownerId ?? userId,
            visibility: "private",
            updatedAt: new Date().toISOString(),
        };
        if (!fitsPlanBudget(next)) throw new TripLimitError(PLAN_TOO_BIG);
        const after = [...list];
        after[i] = next;
        if (!fitsBudget(after)) throw new TripLimitError(ROW_TOO_BIG);
        return after;
    });
    // **無い ID に 200 を返さない。** 返すと、消えたプランを直したつもりの
    // 画面が「保存しました」と出す
    return found ? res : jsonError(404, "プランが見つかりません");
};

/** DELETE /user/trips/{planId} — プランを消す（冪等） */
export const deleteTrip: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    const planId = event.pathParameters?.planId ?? "";
    if (!planId) return jsonError(400, "プランの指定が不正です");

    return writeTrips(userId, "削除に失敗しました", (list) => {
        const next = list.filter((p) => p.planId !== planId);
        // 既に無ければ書かない（冪等）
        return next.length === list.length ? null : next;
    });
};

/**
 * 日付の欄だけを組み立てる。
 *
 * **「送っていない」と「消したい」を分ける**——`null` か空文字なら消す、
 * 送っていなければ前の値のまま。読めない値（`2024-13-99`）は**断らずに
 * 落とす**のではなく、前の値を残す側に倒す（`dateWasRejected` が
 * 撮影日で潰した「黙って消える」を作らない）。
 */
function dateFields(body: Record<string, unknown>, prev?: TripPlan): Partial<TripPlan> {
    const out: Partial<TripPlan> = {};
    for (const key of ["startDate", "endDate"] as const) {
        if (!(key in body)) continue;
        const raw = body[key];
        if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) {
            out[key] = undefined;
            continue;
        }
        const d = sanitizeTripDate(raw);
        out[key] = d ?? prev?.[key];
    }
    return out;
}

/**
 * 書き込みの共通部分。**応答は「書いたあとの一覧」を返す**
 * ——画面が自分で足し引きして持ち回ると、失敗した回に嘘の状態が残る。
 */
async function writeTrips(
    userId: string,
    failMessage: string,
    mutate: (list: TripPlan[]) => TripPlan[] | null,
) {
    try {
        const after: TripPlan[] = [];
        await updateUserList<TripPlan>(tripsId(userId), userId, NO_TRUNCATE, (list) => {
            // **読むときと同じふるいを先に通す。** 通さないと、形の壊れた行が
            // 1つ混ざっただけで「GET には出ないのに数には入る」ことになる
            const kept = list.filter(isStoredTripPlan);
            const next = mutate(kept);
            // **やり直し（CCF）のたびに置き直す。** 足し込むと前の試行が残る
            after.length = 0;
            after.push(...(next ?? kept));
            return next;
        });
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            // **GET と同じものを返す**（3つの口が同じ一覧を見せる）
            body: JSON.stringify({ plans: after }),
        };
    } catch (e) {
        if (e instanceof TripLimitError) return jsonError(403, e.reason);
        if (e instanceof UserListError) {
            console.warn(`trips#${userId} の一覧が競合し続けました:`, e);
            return jsonError(503, "混み合っています。もう一度お試しください");
        }
        console.error("writeTrips error:", e);
        return jsonError(500, failMessage);
    }
}
