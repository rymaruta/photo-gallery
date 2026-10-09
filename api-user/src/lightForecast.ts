import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { requireEnv } from "./env";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { isPro } from "./badgeKeys";
import { isDeletedProfile } from "./types";
import { readUserList } from "./userList";
import { isStoredSpotSlug, spotsId } from "./savedSpots";
import { lightSpotOf, type LightSpot } from "./lightLedger";
import { WEATHER_ATTRIBUTION, getForecast, weatherKitReady, type WxForecast } from "./weatherKit";
import { alertText, pickAlert, weekLight } from "./lightOutlook";
import { apnsConfigured, sendPush } from "./apns";
import { deviceTokens, forgetTokens } from "./devices";

/**
 * **光と天気の知らせ**（Pro の機能・デザインの板 LightAlert）。
 *
 *   GET /user/light-forecast   本人の「行きたい場所」の、今日から7日の光の時刻と見込み
 *   sendLightAlerts（定期実行） 毎日 20:00（日本時間）に、明日の朝・夕に「見込み 高」の
 *                              行きたい場所がある Pro の人へ1通だけ
 *
 * ## 誰が使えるか
 *
 * **Pro の人だけ**（`badgeKeys.ts` の `isPro`・期限も見る）。Pro でなければ 403。
 * WeatherKit の鍵が無ければ（SSM パラメータストア・`weatherKit.ts` の `weatherKitReady()`）
 * 一覧は 503・知らせは何も送らない。
 *
 * ## どのスポットか
 *
 * 「行きたい場所」（`spots#<uid>`）のうち**公式スポットの鍵（`SPOT-<slug>`）**だけ。
 * 撮影地のスラッグ（`/location/*`）は決まった座標を持たないので出さない（`lightLedger.ts`）。
 * 1人あたり新しい方から `MAX_SPOTS` 件まで（WeatherKit の呼び出しの上限を決めるため）。
 *
 * ## 時刻はスポットの現地の時計で
 *
 * 日付・時刻は**そのスポットの時刻帯**（`lightLedger.ts` の `timeZone`・台帳の `timeZone` か国の表）
 * で出す。利用者の端末の時計で言うと、旅先で読み違える（`lib/utils/sunTimes.ts` と同じ考え）。
 */

const USERS_TABLE = requireEnv("USERS_TABLE");

/** 1人あたり見るスポットの上限（新しく入れた方から） */
export const MAX_SPOTS = 20;

/** 画面に出す注記（板の文言そのまま） */
export const LIGHT_NOTE = "天気は外部の予報から。光の時刻はアプリで計算。見込みは目安で、外れることがあります。";

/** 本人の行（Pro の判定と知らせの設定だけ） */
async function readProfileBits(uid: string): Promise<Record<string, unknown> | undefined> {
    const res = await ddb.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId: uid },
        ProjectionExpression: "userId, supporter, lightAlert, deletedAt",
    }));
    return res.Item as Record<string, unknown> | undefined;
}

/** 「行きたい場所」のうち予報を出せるスポット（新しい順・上限つき） */
async function wishedSpots(uid: string): Promise<LightSpot[]> {
    const keys = await readUserList(spotsId(uid), isStoredSpotSlug, `spots#${uid}`);
    const out: LightSpot[] = [];
    for (const k of keys) {
        const s = lightSpotOf(k);
        if (s) out.push(s);
        if (out.length >= MAX_SPOTS) break;
    }
    return out;
}

/** 同時に読む数（WeatherKit を一度に叩きすぎない・Lambda の時間に収める） */
const PARALLEL = 4;

/** 並べて読む。**同じ場所は1回だけ**（`getForecast` の控えが受ける） */
async function forecastsFor(spots: readonly LightSpot[], now: number): Promise<(WxForecast | null)[]> {
    const out: (WxForecast | null)[] = new Array(spots.length).fill(null);
    let next = 0;
    const worker = async () => {
        while (next < spots.length) {
            const i = next++;
            out[i] = await getForecast(spots[i], now);
        }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, spots.length) }, worker));
    return out;
}

/**
 * GET /user/light-forecast
 *
 * 応答（`Cache-Control: private`）:
 *
 *     {
 *       "places": [{
 *         "key": "SPOT-<slug>", "slug", "name", "nameEn"?, "timeZone",
 *         "forecast": true,            // 予報が読めたか（false なら光の時刻だけ）
 *         "days": [{                   // 今日（現地の暦）から7日
 *           "date": "2026-10-10",
 *           "sunrise": { "at": ISO, "clock": "05:42" } | null,
 *           "sunset":  …, "morningBlue": { "start", "end" }, "eveningBlue": { "start", "end" },
 *           "morning": { "weather": "clear"|"partlyCloudy"|"cloudy"|"rain", "chance": "high"|"mid"|"low" } | null,
 *           "evening": …,  // 夕焼け
 *           "night":   …   // 夜景（夕方のブルーアワーから2時間）
 *         }]
 *       }],
 *       "note": "天気は外部の予報から。…",
 *       "attribution": { "serviceName": "Apple Weather", "legalUrl": "…" }   // 画面に出す（Apple の求め）
 *     }
 */
export const getLightForecast: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    if (!await weatherKitReady()) return jsonError(503, "いまは天気の予報を読めません");
    try {
        const me = await readProfileBits(userId);
        if (isDeletedProfile(me)) return jsonError(410, "このアカウントは削除されています");
        if (!isPro(me)) return jsonError(403, "Pro の機能です");

        const now = Date.now();
        const spots = await wishedSpots(userId);
        const wx = await forecastsFor(spots, now);
        const places = spots.map((s, i) => ({
            key: s.key,
            slug: s.slug,
            name: s.name,
            ...(s.nameEn ? { nameEn: s.nameEn } : {}),
            timeZone: s.timeZone,
            forecast: wx[i] !== null,
            days: weekLight(s, wx[i], new Date(now)),
        }));
        return {
            statusCode: 200,
            // **本人だけの答え。共有キャッシュには載せない**。予報は1時間控えるので、端末は10分持ってよい
            headers: { ...JSON_HEADERS, "Cache-Control": "private, max-age=600" },
            body: JSON.stringify({ places, note: LIGHT_NOTE, attribution: WEATHER_ATTRIBUTION }),
        };
    } catch (e) {
        console.error("getLightForecast error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// ─── 前の晩の知らせ ───────────────────────────────────────

/** 受け取る設定か。**既定は受け取る**（`lightAlert === false` のときだけ止める） */
export const wantsLightAlert = (p: { lightAlert?: unknown } | null | undefined) => p?.lightAlert !== false;

/** 走査の1ページ・ページ数の上限（`notify.ts` の `deletedUserIds` と同じ考え） */
const SCAN_PAGE_SIZE = 500;
const SCAN_MAX_PAGES = 200;

/** Pro で、知らせを受け取る設定の人 */
async function alertRecipients(now: number): Promise<string[]> {
    const ids: string[] = [];
    let lastKey: Record<string, unknown> | undefined;
    let pages = 0;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: USERS_TABLE,
            Limit: SCAN_PAGE_SIZE,
            ProjectionExpression: "userId, supporter, lightAlert, deletedAt",
            // 読んだ**あと**に効く絞り（読む量は減らない）。Pro を持たない行を応答から落とすだけ
            FilterExpression: "attribute_exists(supporter) AND attribute_not_exists(deletedAt)",
            ExclusiveStartKey: lastKey,
        }));
        for (const it of (res.Items ?? []) as Record<string, unknown>[]) {
            const id = it.userId;
            if (typeof id === "string" && id && !id.includes("#") && isPro(it, now) && wantsLightAlert(it)) ids.push(id);
        }
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        pages++;
    } while (lastKey && pages < SCAN_MAX_PAGES);
    if (lastKey) console.warn(`sendLightAlerts: ${SCAN_MAX_PAGES}ページで打ち切りました（索引に移す時期）`);
    return ids;
}

/** 二度送らないための印（`lightalert#<uid>`）。その日の分を書けたときだけ送る */
export const lightAlertMarkId = (uid: string) => `lightalert#${uid}`;

/**
 * 今日の印を立てる。**既に立っていれば false**（定期実行のやり直し・重なりで二通送らない）。
 * EventBridge は失敗した呼び出しを最大2回やり直す——印が無いと、途中で落ちた回のやり直しで
 * 送り済みの人にもう1通届く。
 */
async function claimToday(uid: string, day: string): Promise<boolean> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: lightAlertMarkId(uid) },
            UpdateExpression: "SET lastDay = :d, uid = :u",
            ConditionExpression: "attribute_not_exists(lastDay) OR lastDay <> :d",
            ExpressionAttributeValues: { ":d": day, ":u": uid },
        }));
        return true;
    } catch (e) {
        if ((e as { name?: string })?.name === "ConditionalCheckFailedException") return false;
        throw e;
    }
}

/**
 * 1人ぶん: 明日の朝・夕で「見込み 高」のいちばん良い場所を1つ選んで送る。
 *
 * ## 文面は**日本語の文字列をそのまま**送る（`title` / `body`）
 *
 * いつもの通知は鍵（`loc-key`・`NOTIF_LIKE` など）を送り、日英の出し分けは端末の
 * `Localizable.strings` に任せる（`notify.ts`）。**この知らせはそうしない。**
 *
 *  - 新しい鍵（例: `NOTIF_LIGHT`）を送ると、**鍵を持たない古いアプリは鍵の文字列のまま出す**
 *    （iOS は鍵が見つからないと鍵そのものを表示する。`notify.ts` の `LOC_KEYS` の注記）。
 *    Pro の人がいま入れているアプリには、この鍵が無い
 *  - 文面には**場所の名前・時刻・見込み**が入る。鍵の引数（`loc-args`）でも運べるが、
 *    それも新しい鍵が要るので同じ問題に戻る
 *  - 文面そのものなら、どの版のアプリでもそのまま読める
 *
 * 代わりに**英語の端末にも日本語が届く**（サーバーは端末の言語を知らない）。英語の文面は
 * `alertText(_, "en")` で作れるようにしてあるので、アプリが言語を伝えるようになったら
 * （または鍵を持つ版が行き渡ったら）切り替える。
 *
 * **バッジは触らない**（お知らせの一覧に積まないので、未読の数は変わらない）。
 */
async function alertOne(uid: string, now: Date): Promise<"sent" | "none" | "skipped"> {
    const tokens = await deviceTokens(uid);
    if (tokens.length === 0) return "skipped";
    const spots = await wishedSpots(uid);
    if (spots.length === 0) return "none";
    const wx = await forecastsFor(spots, now.getTime());
    const pick = pickAlert(spots.map((spot, i) => ({ spot, wx: wx[i] })), now);
    if (!pick) return "none";
    // 印は日本時間の今日（20:00 の定期実行1回につき1つ）
    const day = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
    if (!await claimToday(uid, day)) return "skipped";
    const text = alertText(pick, "ja");
    const result = await sendPush(tokens, {
        ...text,
        // 押したときの行き先（アプリの `fromPush` は知らない種類を「一覧を開くだけ」にする）
        data: { type: "light", spot: pick.spot.slug, kind: pick.kind, date: pick.date },
    });
    if (result.invalid.length > 0) await forgetTokens(uid, result.invalid);
    return "sent";
}

/**
 * 定期実行（毎日 20:00 日本時間・`serverless.yml`）。
 *
 * **設定が無ければ何もしない**（WeatherKit・APNs のどちらか）。1人の失敗で全体を止めない。
 */
export const sendLightAlerts = async (): Promise<{ recipients: number; sent: number }> => {
    const wkReady = await weatherKitReady();
    if (!wkReady || !apnsConfigured()) {
        console.log(`sendLightAlerts: 設定が無いので送りません（WeatherKit=${wkReady} APNs=${apnsConfigured()}）`);
        return { recipients: 0, sent: 0 };
    }
    const now = new Date();
    const ids = await alertRecipients(now.getTime());
    let sent = 0;
    for (const uid of ids) {
        try {
            if (await alertOne(uid, now) === "sent") sent++;
        } catch (e) {
            console.error(`sendLightAlerts: ${uid} で失敗しました:`, e);
        }
    }
    console.log(`sendLightAlerts: 対象 ${ids.length} 人・送信 ${sent} 通`);
    return { recipients: ids.length, sent };
};
