import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { JSON_HEADERS } from "./http";

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

export const geocodeSearch: APIGatewayProxyHandlerV2 = async (event) => {
    const q = (event.queryStringParameters?.q ?? "").trim().slice(0, QUERY_MAX);
    if (!q) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "地名を入力してください" }) };
    }
    try {
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
