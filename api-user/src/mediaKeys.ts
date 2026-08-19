// 写真 / ストーリーの item から、消すべき S3 オブジェクトキーを集める。
//
// 退会（account.ts）とストーリー削除（stories.ts）で同じ列挙が要る。
// 片方だけ直すと、もう片方に消し残しが出る。定義は1か所にする。

/** URL もしくは生キーから uploads/ 配下の S3 オブジェクトキーを導出する（それ以外は空文字） */
export function deriveUploadKey(v: unknown): string {
    if (typeof v !== "string" || !v) return "";
    if (v.startsWith("uploads/")) return v;
    try {
        const path = new URL(v).pathname.replace(/^\//, "");
        if (path.startsWith("uploads/")) return path;
    } catch { /* URL でなければ無視 */ }
    return "";
}

/**
 * 本体とサムネだけでは足りない。AVIF や小サイズの派生画像、そして
 * srcOriginal（EXIF を落とす前の原本）が残る。srcOriginal には GPS が
 * 入ったままなので、削除後も公開URLで取得できる状態は避ける。
 * scripts/generate-thumbnails.js が作る派生を全部並べておく。
 */
export const MEDIA_FIELDS = [
    "key", "src", "srcOriginal", "srcAvif", "src256",
    "thumbSrc", "thumbSm", "thumbAvif", "thumbSmAvif",
] as const;

/** item から削除すべき S3 キーを重複なく集める */
export function mediaKeys(item: Record<string, unknown>): string[] {
    const keys = new Set<string>();
    for (const field of MEDIA_FIELDS) {
        const k = deriveUploadKey(item[field]);
        if (k) keys.add(k);
    }
    return [...keys];
}
