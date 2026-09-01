import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { JSON_HEADERS } from "./http";

// テーマソングのアプリ内検索。iTunes Search API（認証不要）をサーバー側で叩き、
// フロントには必要な項目だけ返す（CORS 回避 + レスポンス縮小）。

export type SongResult = {
    id: string;
    title: string;
    artist: string;
    artwork: string;       // 大きめのアートワーク URL
    previewUrl: string;    // 30秒プレビュー(m4a/mp3)
    trackUrl: string;      // Apple Music のトラックページ
};

type ITunesTrack = {
    trackId?: number;
    trackName?: string;
    artistName?: string;
    artworkUrl100?: string;
    previewUrl?: string;
    trackViewUrl?: string;
};

export function mapItunesResults(json: unknown): SongResult[] {
    const results = (json as { results?: unknown }).results;
    if (!Array.isArray(results)) return [];
    const out: SongResult[] = [];
    for (const r of results as ITunesTrack[]) {
        if (!r.previewUrl || !r.trackName || !r.artistName) continue;
        out.push({
            id: String(r.trackId ?? `${r.artistName}-${r.trackName}`),
            title: r.trackName,
            artist: r.artistName,
            // 100x100 → 300x300 に差し替えて綺麗に表示
            artwork: (r.artworkUrl100 ?? "").replace("100x100bb", "300x300bb"),
            previewUrl: r.previewUrl,
            trackUrl: r.trackViewUrl ?? "",
        });
    }
    return out;
}

/**
 * 検索語の上限。
 * 制限が無かったので、長い文字列をいくらでも投げられた。1リクエストごとに
 * iTunes への外向き通信を1本開いたまま待つので、同時に大量に叩かれると
 * Lambda の同時実行枠（アカウント全体で共有）を占有し、退会処理など
 * 無関係な処理まで詰まる。ユーザー検索と同じ50文字に揃える。
 */
const QUERY_MAX = 50;

/**
 * 外向き通信の打ち切り。
 *
 * **この関数のタイムアウトは6秒**（`serverless.yml` に個別指定が無く、
 * provider にも無いので serverless の既定。生成された CloudFormation の
 * `Timeout: 6` で確認した）。iTunes が応答を返さないと、その6秒ぶん
 * Lambda の枠を握ったままになる。
 *
 * **枠はアカウント全体で 10 しかない**（2026-09-01 に
 * `lambda:GetAccountSettings` で実測。総枠10・未予約10）。10本が同時に
 * 詰まると、削除・退会・アップロードまで巻き添えでスロットルされる。
 * このファイルの上のコメントはその危険を名指ししていて、対策として
 * `reservedConcurrency` を挙げているが、**総枠10では1つも予約できない**
 * ——予約を入れた本番デプロイが UPDATE_FAILED で巻き戻ったのが同じ日。
 * つまり挙げてある対策は使えないので、握る時間の方を短くする。
 *
 * 3秒にするのは、残り3秒を JSON の読み取りと整形に残すため。
 * `rebuild.ts` が GitHub を叩くときと同じ形（あちらは既に
 * `AbortSignal.timeout` を使っている）——**この関数だけが、Lambda から
 * 出ていく通信のうち唯一タイムアウトを持っていなかった**。
 */
export const FETCH_TIMEOUT_MS = 3000;

export const musicSearch: APIGatewayProxyHandlerV2 = async (event) => {
    const q = (event.queryStringParameters?.q ?? "").trim().slice(0, QUERY_MAX);
    if (!q) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "検索語が必要です" }) };
    }
    // アーティスト名検索でほぼ全曲を出せるよう多めに取得（iTunes の上限は 200）
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=50&country=JP`;
    try {
        const res = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
            return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: "検索に失敗しました" }) };
        }
        const json = (await res.json()) as unknown;
        const results = mapItunesResults(json);
        return {
            statusCode: 200,
            // 検索結果は短時間キャッシュ可（同一検索の連打を抑制）
            headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=300" },
            body: JSON.stringify({ results }),
        };
    } catch (e) {
        // 打ち切りは別のログにする（画面の文言は変えない——利用者にとっては
        // どちらも「検索に失敗した」で、増やすのは ja/en の文言だけになる）。
        // ログで分かれていないと、iTunes が遅いのか落ちているのか読めない。
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        console.error(timedOut ? `musicSearch timeout (${FETCH_TIMEOUT_MS}ms):` : "musicSearch error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "検索に失敗しました" }) };
    }
};
