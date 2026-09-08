import { usableObject, displayString, stringList } from "./apiRows";
import { safeSongPreviewUrl, safeSongArtworkUrl, safeSongTrackUrl } from "./mediaHosts";

/** プロフィールに載る曲。2画面が同じ形を持っている（型は各画面に置いたまま） */
type SongEntry = {
    title: string;
    artist?: string;
    artwork?: string;
    previewUrl: string;
    trackUrl?: string;
};

/**
 * プロフィールの応答を、**画面に入れる前に**形の合った値だけにする。
 *
 * 使うのは2画面。`/profile/<id>`（他人のプロフィール）と
 * `/user/profile`（自分の編集画面）で、どちらも同じ穴を持っていた。
 *
 * これまでは `as UserProfile` で素通しだった（型は実行時に何も確かめない）。
 * 中身は描画の途中で読むので、実測で次の2つを再現している:
 *
 * - `bio` がオブジェクト → React が投げ、`ErrorBoundary` のカードが
 *   **ヘッダーごとページを覆う**（写真一覧も出なくなる）
 * - `pinnedPhotoIds` が配列でない → `pinnedPhotoIds.map is not a function`
 *   （`?? []` は `null` しか拾わない）
 *
 * 編集画面の方は**表示が壊れて終わりではない**。オブジェクトが入力欄に
 * 入ると `[object Object]` になり、保存すると自分の表示名として焼き付く
 * （実測で再現）。
 *
 * 方針は `usablePhotoRows` と同じ——**おかしい項目だけを落とし、
 * 読める項目は出す**。知らない項目はそのまま残す（サーバーが増やした
 * 項目を、こちらが黙って消す方に倒さない）。
 *
 * @returns オブジェクトでない応答（`null` の 200 など）は `null`。
 *   呼び出し側は「取れなかった」として扱う——**「未設定の人」と
 *   同じ見た目にしない**。
 */
export function sanitizeProfile<T extends object>(raw: unknown, label: string): T | null {
    const obj = usableObject<Record<string, unknown>>(raw, label);
    if (!obj) return null;
    const song = (v: unknown): SongEntry => {
        const o = (typeof v === "object" && v !== null && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
        return {
            title: displayString(o.title) ?? "",
            artist: displayString(o.artist),
            // **URL は出すときにも確かめる。** サーバーの許可リストは
            // これから保存する値にしか効かず、**許可リストを入れる前に
            // 保存された行**は任意のホストのまま残りうる（本番を読めないので
            // 実態は未確認）。画面はそれを `<img src>` `<audio src>` で
            // 読み込むので、開いた人の IP・User-Agent・時刻が外部に渡る
            artwork: safeSongArtworkUrl(displayString(o.artwork)),
            previewUrl: safeSongPreviewUrl(displayString(o.previewUrl)) ?? "",
            trackUrl: safeSongTrackUrl(displayString(o.trackUrl)),
        };
    };
    return {
        ...obj,
        userId: displayString(obj.userId) ?? "",
        username: displayString(obj.username),
        displayName: displayString(obj.displayName),
        bio: displayString(obj.bio),
        website: displayString(obj.website),
        instagram: displayString(obj.instagram),
        statusText: displayString(obj.statusText),
        themeColor: displayString(obj.themeColor),
        songUrl: safeSongTrackUrl(displayString(obj.songUrl)),
        songTitle: displayString(obj.songTitle),
        songArtist: displayString(obj.songArtist),
        songArtwork: safeSongArtworkUrl(displayString(obj.songArtwork)),
        songPreviewUrl: safeSongPreviewUrl(displayString(obj.songPreviewUrl)),
        songTrackUrl: displayString(obj.songTrackUrl),
        // 曲は**件数を変えない**（1曲だけ形がおかしくても、残りの並びは
        // そのまま）。中の文字列だけ整える
        songs: Array.isArray(obj.songs) ? obj.songs.map(song) : undefined,
        pinnedPhotoIds: stringList(obj.pinnedPhotoIds),
    } as T;
}
