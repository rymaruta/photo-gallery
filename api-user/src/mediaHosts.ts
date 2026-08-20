// 曲の音源・アートワーク・リンクとして受け付けるホスト。
//
// なぜ要るか:
//   これらは「アプリ内の曲検索（/music/search）が返した値」を、そのまま
//   保存して各画面が読み込む作りになっている。ところが検証は
//   `/^https:\/\//` だけで、コメントには「Apple のホストのみ許可」と
//   書いてあるのに実装がそうなっていなかった。
//
//   通ってしまうと何が起きるか:
//     - previewUrl は StoryViewer が <audio preload="auto"> で**先読み**する
//     - artwork は MiniPlayer / MusicCard が <img> で読み込む
//     - ストーリーはログイン中の全員のトレイに出る
//   つまり任意のURLを1回仕込むだけで、開いた人全員の IP・User-Agent・
//   Referer・時刻を集められる。写真の thumbUrl で塞いだのと同じ穴が、
//   曲まわりの3フィールドに残っていた。
//
// 判定はホスト名の完全一致か、許可ドメインのサブドメインのみ。
// 「末尾一致」だけだと evil-mzstatic.com のような名前が通る。

// 用途ごとに分ける。まとめて "apple.com" を許すと、
// アートワークの欄に音源のURLを入れられるなど、意味の無い組み合わせが通る。
// 許可は「実際にその用途で返ってくるホスト」だけに絞る。
//
// 出どころは musicSearch.ts が中継している iTunes Search API:
//   previewUrl   → audio-ssl.itunes.apple.com / *.mzstatic.com
//   artworkUrl100 → is*-ssl.mzstatic.com
//   trackViewUrl  → music.apple.com
// Apple が配信ホストを変えたらここも変える。そのときは
// 「保存できない」で気づく——外部URLを黙って通すよりそちらがよい。

/** 音源（プレビュー） */
const PREVIEW_HOSTS = ["itunes.apple.com", "mzstatic.com"];
/** アートワーク画像 */
const ARTWORK_HOSTS = ["mzstatic.com"];
/** 曲ページへのリンク */
const TRACK_HOSTS = ["music.apple.com", "itunes.apple.com"];

function hostAllowed(host: string, allowed: readonly string[]): boolean {
    const h = host.toLowerCase();
    return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

/** URL として見る長さの上限。userProfile.ts の形チェックと揃えること */
export const SONG_URL_MAX = 500;

function checkedUrl(v: unknown, max: number, allowed: readonly string[]): string | undefined {
    if (typeof v !== "string") return undefined;
    const s = v.trim().slice(0, max);
    if (!s) return undefined;
    try {
        const u = new URL(s);
        if (u.protocol !== "https:") return undefined;
        return hostAllowed(u.hostname, allowed) ? s : undefined;
    } catch {
        return undefined;
    }
}

/** 曲のプレビュー音源URL。許可ホスト以外は undefined */
export const safeSongPreviewUrl = (v: unknown, max = SONG_URL_MAX) => checkedUrl(v, max, PREVIEW_HOSTS);
/** 曲のアートワークURL。許可ホスト以外は undefined */
export const safeSongArtworkUrl = (v: unknown, max = SONG_URL_MAX) => checkedUrl(v, max, ARTWORK_HOSTS);
/** 曲ページへのリンク。許可ホスト以外は undefined */
export const safeSongTrackUrl = (v: unknown, max = SONG_URL_MAX) => checkedUrl(v, max, TRACK_HOSTS);

export const MEDIA_HOSTS = { PREVIEW_HOSTS, ARTWORK_HOSTS, TRACK_HOSTS } as const;
