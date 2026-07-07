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

export const musicSearch: APIGatewayProxyHandlerV2 = async (event) => {
    const q = (event.queryStringParameters?.q ?? "").trim();
    if (!q) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "検索語が必要です" }) };
    }
    // アーティスト名検索でほぼ全曲を出せるよう多めに取得（iTunes の上限は 200）
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=50&country=JP`;
    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
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
        console.error("musicSearch error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "検索に失敗しました" }) };
    }
};
