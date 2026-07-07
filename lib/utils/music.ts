// プロフィールの「テーマソング」用: 貼り付けられた URL を各サービスの
// 埋め込みプレイヤー URL に変換する。既知のホスト + サニタイズ済み ID からのみ
// iframe src を組み立てるため、任意 URL の埋め込み（iframe インジェクション）を防ぐ。

import { userFetch } from "./api";

export type MusicService = "spotify" | "youtube" | "appleMusic";

// アプリ内検索で選べる曲（iTunes 検索の結果をユーザーAPI経由で取得）
export type SongResult = {
    id: string;
    title: string;
    artist: string;
    artwork: string;
    previewUrl: string;
    trackUrl: string;
};

/** 曲名でアプリ内検索する。認証済みユーザー（プロフィール編集中）から呼ぶ想定。 */
export async function searchSongs(q: string, signal?: AbortSignal): Promise<SongResult[]> {
    const query = q.trim();
    if (!query) return [];
    const res = await userFetch(`/music/search?q=${encodeURIComponent(query)}`, { signal });
    if (!res.ok) throw new Error("music search failed");
    const data = (await res.json()) as { results?: SongResult[] };
    return Array.isArray(data.results) ? data.results : [];
}

export type MusicEmbed = {
    service: MusicService;
    embedUrl: string;
    /** 埋め込みプレイヤーの高さ(px)。YouTube はレスポンシブ(16:9)のため未指定。 */
    height?: number;
};

function parseSpotify(u: URL): MusicEmbed | null {
    if (u.hostname.replace(/^www\./, "") !== "open.spotify.com") return null;
    // /track/xxx, /intl-ja/track/xxx, /album, /playlist, /episode, /show
    const m = u.pathname.match(/\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
    if (!m) return null;
    return { service: "spotify", embedUrl: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: 152 };
}

function parseYouTube(u: URL, start?: number, end?: number): MusicEmbed | null {
    const host = u.hostname.replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") {
        id = u.pathname.slice(1);
    } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
        id = u.searchParams.get("v") ?? "";
    } else {
        return null;
    }
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    // 好きな部分だけ再生: YouTube は ?start= / ?end=（秒）でクリップ再生できる
    const params = new URLSearchParams();
    if (typeof start === "number" && start > 0) params.set("start", String(Math.floor(start)));
    if (typeof end === "number" && end > 0 && (!start || end > start)) params.set("end", String(Math.floor(end)));
    const qs = params.toString();
    return { service: "youtube", embedUrl: `https://www.youtube.com/embed/${id}${qs ? `?${qs}` : ""}` };
}

function parseAppleMusic(u: URL): MusicEmbed | null {
    if (u.hostname.replace(/^www\./, "") !== "music.apple.com") return null;
    if (!/^\/[a-z]{2}\/(album|playlist|song)\//.test(u.pathname)) return null;
    return { service: "appleMusic", embedUrl: `https://embed.music.apple.com${u.pathname}${u.search}`, height: 175 };
}

/**
 * サポート対象(Spotify / YouTube / Apple Music)なら埋め込み情報を返す。非対応なら null。
 * start / end（秒）を渡すと「好きな部分だけ再生」に対応（現状 YouTube のみ有効）。
 */
export function parseMusicEmbed(raw: string, start?: number, end?: number): MusicEmbed | null {
    const url = (raw ?? "").trim();
    if (!url) return null;
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return parseSpotify(u) ?? parseYouTube(u, start, end) ?? parseAppleMusic(u);
}

export function musicServiceLabel(service: MusicService): string {
    switch (service) {
        case "spotify": return "Spotify";
        case "youtube": return "YouTube";
        case "appleMusic": return "Apple Music";
    }
}
