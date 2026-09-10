import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { JSON_HEADERS } from "./http";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

// 撮影地の位置さがし。OpenStreetMap の Nominatim（無料・キー不要）を
// **サーバー側で**叩いて、候補だけ返す。
//
// **なぜサーバー越しか。** (1) 画面から直接叩くと利用者の IP と閲覧が
// 相手に渡る、(2) Nominatim は「識別できる User-Agent」を求めていて、
// ブラウザからは名乗れない、(3) 打鍵ごとの検索は規約で禁じられているので、
// 「探す」を押したときだけ1回投げる形にしたい。
// 作りは `musicSearch.ts`（iTunes の代理）と同じ。

export type PlaceResult = {
    /** 画面に出す名前（Nominatim の display_name） */
    label: string;
    lat: number;
    lng: number;
};

/**
 * 検索語の上限。曲検索・ユーザー検索は50だが、こちらは**撮影地名を
 * そのまま渡す**ので、画面の入力上限（`LOCATION_MAX = 200`）に近い値が要る。
 * 200 をそのまま許すと外向きの URL が長くなるだけなので 100 で切る。
 */
const QUERY_MAX = 100;

/**
 * 外向き通信の打ち切り。**この関数のタイムアウトは6秒**（`serverless.yml` に
 * 明示。既定に頼らない——`musicSearch` が「書いていないと、外向きの打ち切りが
 * 何と比べて短いのかコードから読めない」として明示した経緯に倣う）。
 * 残り3秒を JSON の読み取りと整形に残す。
 */
export const FETCH_TIMEOUT_MS = 3000;

/**
 * Nominatim の利用規約: **識別できて、問題があれば連絡が取れる** User-Agent。
 * サイトの URL を入れる（そこから連絡先に辿れる）。`serverless.yml` から
 * `GEOCODE_UA` を渡せば上書きできる。
 */
const UA = process.env.GEOCODE_UA || "journey-photo.com place picker (+https://journey-photo.com/privacy)";

/**
 * 座標は**約1km（小数2桁）に丸める**。アップロードの `sanitizeCoords` と
 * 同じ精度で、地図のピンの粒度もこれに揃えてある。撮影者が選んだ場所でも、
 * 自宅が特定できる細かさでは残さない。
 */
export function mapNominatimResults(json: unknown): PlaceResult[] {
    if (!Array.isArray(json)) return [];
    const out: PlaceResult[] = [];
    for (const r of json as Array<Record<string, unknown>>) {
        if (!r || typeof r !== "object") continue;
        const lat = Number(r.lat);
        const lng = Number(r.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
        const label = typeof r.display_name === "string" ? r.display_name : "";
        if (!label) continue;
        out.push({ label, lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 });
    }
    return out;
}

/**
 * 結果の控え。**Nominatim の規約は「結果はこちらでキャッシュせよ」と求める**。
 * `Cache-Control` はブラウザ個別にしか効かない（画面は API Gateway を直に
 * 叩く）ので、別の利用者が同じ地名を引けばまた相手に飛んでいた。
 * 写真テーブルに `geocache#<地名>` で置く（`src` を持たないので、一覧・
 * ビルド・掃除のどれにも写真として現れない——`like#`/`notifs#` と同じ扱い）。
 * テーブルに TTL は無いので、古さは読むときに見る。
 */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const cacheKey = (q: string) => `geocache#${q.replace(/[\s　]+/g, " ").trim()}`;

async function readCache(q: string): Promise<PlaceResult[] | null> {
    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: cacheKey(q) } }));
        const item = res.Item as { results?: unknown; cachedAt?: unknown } | undefined;
        if (!item || !Array.isArray(item.results)) return null;
        const at = Number(item.cachedAt);
        if (!Number.isFinite(at) || Date.now() - at > CACHE_TTL_MS || Date.now() < at) return null;
        return mapNominatimResults(item.results.map((r) => ({ lat: (r as PlaceResult).lat, lon: (r as PlaceResult).lng, display_name: (r as PlaceResult).label })));
    } catch (e) {
        // 控えが読めなくても探すことはできる。黙らない（ロールの権限漏れに気づくため）
        console.warn("geocodeSearch cache read failed:", e);
        return null;
    }
}

async function writeCache(q: string, results: PlaceResult[]): Promise<void> {
    try {
        await ddb.send(new PutCommand({
            TableName: PHOTOS_TABLE,
            Item: { id: cacheKey(q), results, cachedAt: Date.now() },
        }));
    } catch (e) {
        console.warn("geocodeSearch cache write failed:", e);
    }
}

/**
 * 相手に投げる間隔。規約の「1リクエスト/秒を超えない」を、少なくとも
 * **同じ Lambda インスタンスの中では**守る（並列に起きたインスタンス同士は
 * 揃えられない——そこは上の控えで当たり回数そのものを減らす）。
 */
const MIN_INTERVAL_MS = 1000;
let lastRequestAt = 0;
async function waitForSlot(): Promise<void> {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
}

export const geocodeSearch: APIGatewayProxyHandlerV2 = async (event) => {
    const q = (event.queryStringParameters?.q ?? "").trim().slice(0, QUERY_MAX);
    if (!q) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "地名を入力してください" }) };
    }
    const cached = await readCache(q);
    if (cached) {
        return { statusCode: 200, headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=600" }, body: JSON.stringify({ results: cached }) };
    }
    try {
        await waitForSlot();
        // **URL の組み立ても try の中に置く。** `slice` はサロゲートペアを
        // 割るので、100文字目が絵文字だと `encodeURIComponent` が URIError を
        // 投げる。外に置くと JSON のエラー本文もログも通らず素の例外で落ちる
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ja&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, {
            headers: { "User-Agent": UA, Accept: "application/json" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
            return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: "位置を探せませんでした" }) };
        }
        const results = mapNominatimResults(await res.json());
        await writeCache(q, results);
        return {
            statusCode: 200,
            // 同じ地名の連打を抑える（相手の負荷も減る）
            headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=600" },
            body: JSON.stringify({ results }),
        };
    } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        console.error(timedOut ? `geocodeSearch timeout (${FETCH_TIMEOUT_MS}ms):` : "geocodeSearch error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "位置を探せませんでした" }) };
    }
};

/**
 * 座標 → 地名（アップロード時の自動入力）。
 *
 * これまで**利用者のブラウザから直接 Nominatim に座標を送っていた**
 * （`lib/utils/exif.ts` の旧 `reverseGeocode`）。上の位置さがしをサーバー越しに
 * した理由（IP を渡さない・名乗る・回数を抑える）はこちらにもそのまま当てはまる
 * ——しかも送っているのは**撮影した場所の座標**で、地名の文字より重い。
 * 座標は約1km（小数2桁）に丸めてから引き、市区町村レベル（zoom=10）で聞く。
 * 結果は座標ごとに30日控える。
 */
export function placeNameFromReverse(json: unknown): string | null {
    if (!json || typeof json !== "object") return null;
    const data = json as { address?: Record<string, string>; display_name?: string };
    const a = data.address ?? {};
    const parts = [
        a.city ?? a.town ?? a.village ?? a.suburb ?? a.county,
        a.state ?? a.region,
        a.country,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(", ");
    return typeof data.display_name === "string" && data.display_name ? data.display_name : null;
}

export const geocodeReverse: APIGatewayProxyHandlerV2 = async (event) => {
    const lat = Number(event.queryStringParameters?.lat);
    const lng = Number(event.queryStringParameters?.lng);
    const locale = event.queryStringParameters?.locale === "en" ? "en" : "ja";
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "座標が不正です" }) };
    }
    const rlat = Math.round(lat * 100) / 100;
    const rlng = Math.round(lng * 100) / 100;
    const key = `rev:${locale}:${rlat},${rlng}`;
    // 控え（地名の検索と同じ表・同じ期限）
    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: cacheKey(key) } }));
        const item = res.Item as { place?: unknown; cachedAt?: unknown } | undefined;
        const at = Number(item?.cachedAt);
        if (item && (typeof item.place === "string" || item.place === null) && Number.isFinite(at) && Date.now() - at <= CACHE_TTL_MS && Date.now() >= at) {
            return { statusCode: 200, headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=600" }, body: JSON.stringify({ place: item.place }) };
        }
    } catch (e) {
        console.warn("geocodeReverse cache read failed:", e);
    }
    try {
        await waitForSlot();
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${rlat}&lon=${rlng}&zoom=10&accept-language=${locale}`;
        const res = await fetch(url, {
            headers: { "User-Agent": UA, Accept: "application/json" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
            return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: "地名を引けませんでした" }) };
        }
        const place = placeNameFromReverse(await res.json());
        try {
            await ddb.send(new PutCommand({ TableName: PHOTOS_TABLE, Item: { id: cacheKey(key), place, cachedAt: Date.now() } }));
        } catch (e) {
            console.warn("geocodeReverse cache write failed:", e);
        }
        return { statusCode: 200, headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=600" }, body: JSON.stringify({ place }) };
    } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        console.error(timedOut ? `geocodeReverse timeout (${FETCH_TIMEOUT_MS}ms):` : "geocodeReverse error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "地名を引けませんでした" }) };
    }
};
