import { createPrivateKey, sign } from "node:crypto";
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

/**
 * Apple の天気（WeatherKit の REST API）を読む口。
 *
 * ## 鍵は SSM パラメータストアに置く（owner の決定・2026-10-09）
 *
 * **owner が AWS の画面で作る**2つのパラメータ（SecureString は CloudFormation で作れないので、
 * こちらでは作らない）。`<stage>` は prod / staging:
 *
 *     /journey-photo/<stage>/weatherkit/key-id       String       キー ID（例: ABC123DEFG）
 *     /journey-photo/<stage>/weatherkit/private-key  SecureString .p8 の中身をそのまま（改行込み）
 *
 * 環境変数（`serverless.yml` から**読む関数にだけ**配る・IAM-2 と同じ考え）:
 *
 *   WEATHERKIT_PARAM_PREFIX  パラメータの道の頭（`/journey-photo/<stage>/weatherkit`）。
 *                            その下の `ssm:GetParameter(s)` だけを許してある
 *   WEATHERKIT_TEAM_ID       チーム ID（JWT の `iss`）。公開識別子なので設定に値で書く
 *   WEATHERKIT_SERVICE_ID    サービス ID（JWT の `sub`）。同上
 *
 * **どれかが空・パラメータが無い／空・読めない・鍵として読めないなら `weatherKitReady()` が
 * false** で、一覧の口は 503・前の晩の知らせは何も送らない。既定値は置かない
 * （CLAUDE.md「本番値のフォールバックは置かない」）。
 *
 * SecureString の復号は AWS 管理の既定の鍵（`aws/ssm`）。この鍵の鍵ポリシーは「同じアカウントで
 * SSM を通して使う人」に復号を許しているので、**IAM に `kms:Decrypt` は足していない**
 * （客の管理する鍵に替えたら要る）。
 *
 * 鍵は Lambda の中で **5分** 控える（呼び出しのたびに SSM を叩かない。owner が値を入れてから
 * 効くまで最大5分）。読めなかった回も1分は控える（鍵の無いあいだ、一覧を開くたびに読みにいかない）。
 *
 * ## 呼び出しを減らす（無料枠は月50万回）
 *
 * 同じ場所（座標を小数2桁＝約1km に丸めたもの）の予報は**1時間** DynamoDB に控える
 * （`geocodeSearch.ts` の `geocache#` と同じ形・写真テーブルの `wxcache#<緯度>,<経度>,<時刻帯>`）。
 * 控えるのは使う項目だけに縮めた形（1か所およそ15KB）で、応答の全文は置かない。
 *
 * ## 表示の決まり
 *
 * WeatherKit は**出典（Apple Weather の印と法的な案内への導線）を画面に出す**ことを求める。
 * 一覧の応答に `attribution` を載せる（画面側が出す）。
 */

const PARAM_PREFIX = (process.env.WEATHERKIT_PARAM_PREFIX ?? "").replace(/\/+$/, "");
const TEAM_ID = process.env.WEATHERKIT_TEAM_ID ?? "";
const SERVICE_ID = process.env.WEATHERKIT_SERVICE_ID ?? "";

export type WeatherKitKey = { keyId: string; privateKey: string };

/**
 * パラメータの値から鍵を作る。**純関数**（テストで形を縛る）。
 * どちらかが空・鍵として読めないなら null（＝機能を止める）。
 * 鍵の改行が `\n` の文字のまま入っていることがある（画面に1行で貼った場合）ので戻す。
 */
export function toWeatherKitKey(keyIdRaw: unknown, privateKeyRaw: unknown): WeatherKitKey | null {
    const keyId = typeof keyIdRaw === "string" ? keyIdRaw.trim() : "";
    const privateKey = typeof privateKeyRaw === "string" ? privateKeyRaw.replace(/\\n/g, "\n").trim() : "";
    if (!keyId || !privateKey) return null;
    try {
        createPrivateKey(privateKey);
    } catch {
        console.warn("WeatherKit: private-key を鍵として読めません（.p8 の中身をそのまま入れてください）");
        return null;
    }
    return { keyId, privateKey };
}

const KEY_TTL_MS = 5 * 60 * 1000;
const MISS_TTL_MS = 60 * 1000;
/** `failed`: SSM を**読めなかった**（パラメータが無いのではなく、通信・権限・混雑で落ちた） */
let cachedKey: { value: WeatherKitKey | null; at: number; failed: boolean } | null = null;
let ssm: SSMClient | null = null;

/** 控えを捨てる（テストから・401 を受けたとき） */
export function resetWeatherKitKey(): void {
    cachedKey = null;
}

/**
 * 鍵（控え → SSM パラメータストア）。**読めなければ null（投げない）**
 *
 * @param opts.retryFailed 前の回が**読み込みの失敗**なら控えを使わず読み直す（定期実行の
 *   やり直し用。`sendLightAlerts` の注記）
 */
export async function weatherKitKey(now = Date.now(), opts: { retryFailed?: boolean } = {}): Promise<WeatherKitKey | null> {
    if (!PARAM_PREFIX || !TEAM_ID || !SERVICE_ID) return null;
    if (cachedKey && !(opts.retryFailed && cachedKey.failed)
        && now - cachedKey.at < (cachedKey.value ? KEY_TTL_MS : MISS_TTL_MS)) return cachedKey.value;
    let value: WeatherKitKey | null = null;
    let failed = false;
    try {
        ssm ??= new SSMClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
        const idName = `${PARAM_PREFIX}/key-id`, keyName = `${PARAM_PREFIX}/private-key`;
        const res = await ssm.send(new GetParametersCommand({ Names: [idName, keyName], WithDecryption: true }));
        const byName = new Map((res.Parameters ?? []).map((p) => [p.Name, p.Value]));
        if ((res.InvalidParameters ?? []).length > 0) {
            console.warn(`WeatherKit: パラメータがまだありません（${(res.InvalidParameters ?? []).join(", ")}）`);
        }
        value = toWeatherKitKey(byName.get(idName), byName.get(keyName));
    } catch (e) {
        failed = true;
        console.warn("WeatherKit: パラメータを読めませんでした:", e);
    }
    cachedKey = { value, at: now, failed };
    return value;
}

/** 使えるか。使えなければ機能を止める（一覧は 503・知らせは送らない） */
export async function weatherKitReady(now = Date.now(), opts: { retryFailed?: boolean } = {}): Promise<boolean> {
    return (await weatherKitKey(now, opts)) !== null;
}

/**
 * いちばん最近の鍵の読み込みが**失敗**だったか（パラメータが無い・空・鍵として読めないは
 * 失敗ではない＝設定の問題で、やり直しても変わらない）
 */
export function weatherKitKeyReadFailed(): boolean {
    return cachedKey?.failed === true;
}

/** 画面に出す出典（Apple の求め）。文言は Apple の案内どおり */
export const WEATHER_ATTRIBUTION = {
    serviceName: "Apple Weather",
    legalUrl: "https://weatherkit.apple.com/legal-attribution.html",
} as const;

// ─── 署名（JWT） ───────────────────────────────────────────

/** 署名の寿命。1時間で作り、50分で作り直す（`apns.ts` と同じ間合い） */
const JWT_LIFETIME_SEC = 60 * 60;
const JWT_REUSE_MS = 50 * 60 * 1000;
let cachedJwt: { value: string; at: number; keyId: string } | null = null;

function base64url(input: Buffer | string): string {
    return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * WeatherKit の JWT（ES256）。
 *
 *   header  { alg: "ES256", kid: キーID, id: "チームID.サービスID" }
 *   payload { iss: チームID, iat, exp, sub: サービスID }
 *
 * **署名は R||S の生の形**（`ieee-p1363`）。既定の DER で送ると 401 になる
 * （`apns.ts` の `providerToken` と同じ落とし穴）。鍵を入れ替えたら作り直す。
 */
export function weatherKitToken(key: WeatherKitKey, now = Date.now()): string {
    if (cachedJwt && cachedJwt.keyId === key.keyId && now - cachedJwt.at < JWT_REUSE_MS) return cachedJwt.value;
    const iat = Math.floor(now / 1000);
    const header = base64url(JSON.stringify({ alg: "ES256", kid: key.keyId, id: `${TEAM_ID}.${SERVICE_ID}` }));
    const payload = base64url(JSON.stringify({ iss: TEAM_ID, iat, exp: iat + JWT_LIFETIME_SEC, sub: SERVICE_ID }));
    const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
        key: createPrivateKey(key.privateKey),
        dsaEncoding: "ieee-p1363",
    });
    const value = `${header}.${payload}.${base64url(signature)}`;
    cachedJwt = { value, at: now, keyId: key.keyId };
    return value;
}

/** 署名を捨てる（401 を受けたときと、テストから） */
export function resetWeatherKitToken(): void {
    cachedJwt = null;
}

// ─── 予報の形（使う項目だけ） ─────────────────────────────

/**
 * 1時間ぶんの予報。割合は 0〜1。
 * 層ごとの雲量（`low`・`mid`・`high`）は応答に無いことがあるので任意。
 * **2026-10-09 に本物の応答（東京駅・本番の鍵）で確かめたら、層ごとの雲量は入っていなかった**
 * （`cloudCover` と `precipitationChance` はある）。見込みは全体の雲量でも決められるようにしてある
 * （`lightOutlook.ts` の `glowChance`）。見通し（`visibility`・メートル）と湿度（`humidity`）も任意。
 */
export type WxHour = {
    /** その1時間の始まり（epoch ミリ秒） */
    t: number;
    /** 雲量（全体） */
    cloud: number;
    low?: number;
    mid?: number;
    high?: number;
    /** 降水確率 */
    rain: number;
    /** 見通し（メートル）。応答に無ければ undefined */
    vis?: number;
    /** 湿度（0〜1）。応答に無ければ undefined */
    hum?: number;
    /** WeatherKit の `conditionCode`（"Clear"・"Rain" …） */
    code: string;
};

export type WxForecast = { hours: WxHour[]; fetchedAt: number };

const frac = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : undefined;
};

/**
 * WeatherKit の応答を使う形に縮める。**読めない時間は捨てる**（雲量か時刻の無い行）。
 * 純関数——テストは固定の応答（`__tests__/fixtures/weatherkit-*.json`）で見張る。
 */
export function parseWeather(json: unknown, fetchedAt: number): WxForecast {
    const hoursRaw = (json as { forecastHourly?: { hours?: unknown } } | null)?.forecastHourly?.hours;
    const hours: WxHour[] = [];
    if (Array.isArray(hoursRaw)) {
        for (const h of hoursRaw as Record<string, unknown>[]) {
            if (!h || typeof h !== "object") continue;
            const t = typeof h.forecastStart === "string" ? Date.parse(h.forecastStart) : NaN;
            const cloud = frac(h.cloudCover);
            if (!Number.isFinite(t) || cloud === undefined) continue;
            const low = frac(h.cloudCoverLowAltPct), mid = frac(h.cloudCoverMidAltPct), high = frac(h.cloudCoverHighAltPct);
            const vis = typeof h.visibility === "number" && Number.isFinite(h.visibility) && h.visibility >= 0 ? h.visibility : undefined;
            const hum = frac(h.humidity);
            hours.push({
                t,
                cloud,
                ...(low !== undefined ? { low } : {}),
                ...(mid !== undefined ? { mid } : {}),
                ...(high !== undefined ? { high } : {}),
                rain: frac(h.precipitationChance) ?? 0,
                ...(vis !== undefined ? { vis } : {}),
                ...(hum !== undefined ? { hum } : {}),
                code: typeof h.conditionCode === "string" ? h.conditionCode : "",
            });
        }
    }
    hours.sort((a, b) => a.t - b.t);
    return { hours, fetchedAt };
}

// ─── 読む ─────────────────────────────────────────────────

/** 何日先まで読むか。今日から7日（一覧）＋ブルーアワーの後ろまで */
const FORECAST_DAYS = 8;
/** 外向き通信の打ち切り */
export const FETCH_TIMEOUT_MS = 5000;
/** 控えの寿命 */
export const CACHE_TTL_MS = 60 * 60 * 1000;

/** 約1km に丸める（台帳の座標と同じ精度） */
const round2 = (x: number) => Math.round(x * 100) / 100;

/** 要求の URL。**純関数**（テストで形を縛る） */
export function weatherUrl(lat: number, lng: number, timeZone: string, now: number, lang = "ja"): string {
    const start = new Date(Math.floor(now / 3_600_000) * 3_600_000).toISOString();
    const end = new Date(now + FORECAST_DAYS * 86_400_000).toISOString();
    const q = new URLSearchParams({
        dataSets: "forecastDaily,forecastHourly",
        timezone: timeZone,
        hourlyStart: start,
        hourlyEnd: end,
        dailyEnd: end,
    });
    return `https://weatherkit.apple.com/api/v1/weather/${lang}/${round2(lat)}/${round2(lng)}?${q.toString()}`;
}

export const wxCacheKey = (lat: number, lng: number, timeZone: string) => `wxcache#${round2(lat)},${round2(lng)},${timeZone}`;

/** 呼び出しの間で使い回す控え（温まったコンテナの中だけ）。DynamoDB の手前 */
const memo = new Map<string, WxForecast>();

/**
 * いま読みに行っている最中の場所。**同じ場所を同時に読みに行かない**——知らせの定期実行は
 * 何人かを並べて回るので、同じスポットを入れた人どうしが同じ瞬間に WeatherKit を叩きうる
 */
const inflight = new Map<string, Promise<WxForecast | null>>();

export function resetWeatherMemo(): void {
    memo.clear();
    inflight.clear();
}

async function readCache(key: string, now: number): Promise<WxForecast | null> {
    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: key } }));
        const item = res.Item as { hours?: unknown; fetchedAt?: unknown } | undefined;
        const at = Number(item?.fetchedAt);
        if (!item || !Number.isFinite(at) || now - at >= CACHE_TTL_MS || !Array.isArray(item.hours)) return null;
        return { hours: item.hours as WxHour[], fetchedAt: at };
    } catch (e) {
        console.warn("weatherKit cache read failed:", e);
        return null;
    }
}

async function writeCache(key: string, wx: WxForecast): Promise<void> {
    try {
        await ddb.send(new PutCommand({ TableName: PHOTOS_TABLE, Item: { id: key, hours: wx.hours, fetchedAt: wx.fetchedAt } }));
    } catch (e) {
        console.warn("weatherKit cache write failed:", e);
    }
}

/**
 * その場所の予報（控え → WeatherKit の順）。**読めなければ null**（投げない）。
 * 設定が無ければ外へは一度も出ない。
 */
export async function getForecast(
    spot: { lat: number; lng: number; timeZone: string },
    now = Date.now(),
): Promise<WxForecast | null> {
    const wkKey = await weatherKitKey(now);
    if (!wkKey) return null;
    const key = wxCacheKey(spot.lat, spot.lng, spot.timeZone);
    const hit = memo.get(key);
    if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit;
    const pending = inflight.get(key);
    if (pending) return pending;
    const p = loadForecast(key, spot, wkKey, now).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
}

/** 控え（DynamoDB）→ WeatherKit。`getForecast` が同じ場所につき同時に1本だけ走らせる */
async function loadForecast(
    key: string,
    spot: { lat: number; lng: number; timeZone: string },
    wkKey: WeatherKitKey,
    now: number,
): Promise<WxForecast | null> {
    const cached = await readCache(key, now);
    if (cached) { memo.set(key, cached); return cached; }

    try {
        const res = await fetch(weatherUrl(spot.lat, spot.lng, spot.timeZone, now), {
            headers: { Authorization: `Bearer ${weatherKitToken(wkKey, now)}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
            // 断られた署名は捨てる（鍵を入れ替えたあとに温まったコンテナが50分失敗し続けない）
            // 鍵も読み直す（owner が画面で値を入れ替えた直後に、古い控えで失敗し続けない）
            if (res.status === 401 || res.status === 403) { resetWeatherKitToken(); resetWeatherKitKey(); }
            console.warn(`WeatherKit ${res.status}（${key}）`);
            return null;
        }
        const wx = parseWeather(await res.json(), now);
        if (wx.hours.length === 0) {
            console.warn(`WeatherKit: 時間ごとの予報が空でした（${key}）`);
            return null;
        }
        memo.set(key, wx);
        await writeCache(key, wx);
        return wx;
    } catch (e) {
        console.warn(`WeatherKit を読めませんでした（${key}）:`, e);
        return null;
    }
}
