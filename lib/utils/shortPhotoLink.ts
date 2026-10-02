// lib/utils/shortPhotoLink.ts
// 写真の短縮リンク `/?p=<写真 ID の先頭8文字>`（2026-10-02）。
//
// アプリから Threads に載せる文の最後に「Journey Photo」とその下にリンクを置く
// （owner「短縮リンクは載せれる？」）。`/?photo=<UUID>` は62文字あり、Threads の本文に
// そのまま並んで見た目を崩す。先頭8文字（16進）なら `https://journey-photo.com/?p=a0e0e987`
// で37文字。外部の短縮サービスは使わない（自分のドメインのまま・他社に飛ばさない）。
//
// **静的書き出しなので `/p/<id>` は建てられない**（列挙外は404）。`/j?t=`・`/?photo=` と
// 同じクエリの形にして、トップで一覧と照らして `/?photo=<id>` に置き換える。

/** 短縮に使う文字数（UUID v4 の先頭の16進8文字＝約43億通り） */
export const SHORT_PHOTO_ID_LENGTH = 8;

const SHORT = /^[0-9a-f]{8}$/;

export type ShortPhotoResolution =
    | { kind: "invalid" }        // 短縮の形をしていない（触らない）
    | { kind: "found"; id: string }
    | { kind: "ambiguous" }      // 2枚以上が同じ先頭（開く写真を選べない）
    | { kind: "none" };          // 一覧に無い（まだ届いていない・消された）

/** 写真 ID から短縮の8文字を作る（アプリと同じ規則） */
export function shortPhotoId(id: string): string {
    return id.slice(0, SHORT_PHOTO_ID_LENGTH).toLowerCase();
}

/**
 * `?p=` の値を、一覧の写真 ID に照らす。
 * **大文字は小文字に寄せる**（手で打ち直されたリンク）。形が違うものは触らない。
 */
export function resolveShortPhotoId(short: string | null, ids: readonly string[]): ShortPhotoResolution {
    const key = (short ?? "").trim().toLowerCase();
    if (!SHORT.test(key)) return { kind: "invalid" };
    const hits = ids.filter((id) => id.toLowerCase().startsWith(key));
    if (hits.length === 1) return { kind: "found", id: hits[0] };
    return hits.length > 1 ? { kind: "ambiguous" } : { kind: "none" };
}
