// 写真 / ストーリーの item から、消すべき S3 オブジェクトキーを集める。
//
// 退会（account.ts）とストーリー削除（stories.ts）で同じ列挙が要る。
// 片方だけ直すと、もう片方に消し残しが出る。定義は1か所にする。

/**
 * URL もしくは生キーから uploads/ 配下の S3 オブジェクトキーを導出する（それ以外は空文字）。
 *
 * パスは**デコードしてから**判定する。保存時の検証（uploadPolicy.isOwnUploadUrl）は
 * デコードして見ているのに、ここが生のままだったため、両者の判断が食い違っていた:
 *   https://cdn/up%6Coads/<uid>/x.jpg
 *     → 検証側: デコードすると /uploads/... なので「自分の領域」＝保存OK
 *     → 削除側: "up%6Coads/..." は uploads/ で始まらない＝削除対象から外れる
 * CloudFront と S3 は %6C をデコードして解決するので画像は普通に表示される。
 * つまり「写真を消しても、退会しても、実体だけ公開URLに残り続ける」状態を
 * 自分で作れた。消えたと表示され、成功も返るのに残る——一番まずい壊れ方。
 */
export function deriveUploadKey(v: unknown): string {
    if (typeof v !== "string" || !v) return "";
    const decodeOnce = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
    if (v.startsWith("uploads/")) {
        // docstring の「`..` を含むキーは扱わない」は URL 経路にしか
        // 入っておらず、生キーだけ素通りだった（テストまで逆の挙動を
        // 固定していた）。今の保存経路では `..` 入りのキーは作れないが、
        // 判定を経路で分けない。
        const key = decodeOnce(v);
        return key.includes("..") ? "" : key;
    }
    try {
        const path = decodeOnce(new URL(v).pathname).replace(/^\//, "");
        // ".." を含むキーは扱わない（S3 のキーとしては正当だが、
        // 意図せず別の場所を指す形になっていないかを確かめる術が無い）
        if (path.includes("..")) return "";
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
