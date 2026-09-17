import { sanitizeExif, sanitizeCoords, sanitizeBlurDataURL, sanitizeDate } from "./sanitize";
import { uploadPrefix, canonicalUploadUrl, isOwnUploadUrlFromEnv as isOwnUploadUrl } from "./uploadPolicy";

/**
 * **写真の差し替え**（消して投稿し直さずに、実体だけ入れ替える）。
 *
 * owner の要望（2026-09-17）:「写真のEXIF情報のためだけに公開した写真を
 * 消して再度投稿してEXIF情報を入れ直すのがめんどう。写真だけ置き換えて
 * EXIF情報などを更新してくれるようにしたい」
 *
 * **消して投稿し直すと失うもの**（差し替えなら全部残る）:
 *
 *     /photo/<id> の URL   変わる＝検索の評価がリセットされる
 *     いいね・コメント      消える（`like#` `comments#` は写真IDに紐づく）
 *     投稿日・並び順        今日になる
 *     アルバム・ピン留め    外れる
 *
 * 🔴 **いちばん危ないのは「派生を残したまま `src` だけ替える」こと。**
 *
 * 写真には**ビルドが作る派生**がある（`scripts/generate-thumbnails.js`）。
 * `srcAvif` を残したまま実体だけ替えると、**AVIF を出す端末には古い写真が
 * 出続ける**——端末によって見える写真が違う、という気づきにくい壊れ方。
 * だから差し替えでは**派生を消して**、次のビルドで作り直させる。
 *
 * ビルドは「空なら埋める」で動くので、消せば必ず作り直される。
 * 消す項目がビルドの一覧とずれないことは `photoReplace.test.ts` が見張る
 * （**片方だけ増えると静かにずれる**——このリポジトリが何度も踏んだ型）。
 */

/**
 * 差し替えのときに**消す**項目。
 *
 * ここに挙げるのは「ビルドが作るもの」＝古い写真のまま残ると嘘になるもの。
 *
 * `src` `thumbSrc` `dominantColor` `blurDataURL`（＝`REPLACE_SETS`）は
 * **送られたら上書き、送られなければ消す**（下の `buildReplace` を参照）。
 * 消すのは、古い写真の値が残るよりビルドに作り直させる方が正しいから。
 */
export const REPLACE_CLEARS = [
    // 寸法（ビルドが元画像から測る）。縦横比が変わる差し替えで残すと
    // レイアウトが崩れたまま次のビルドまで直らない
    "width", "height", "aspectRatio",
    // AVIF / 256px の派生。**残すと端末によって古い写真が出る**
    "thumbAvif", "thumbSm", "thumbSmAvif", "srcAvif",
    // 古い形（今のどの経路も書かないが、持っている行があれば古い実体を指す）
    "src256", "srcOriginal",
] as const;

/** 差し替えで**画面から受け取って上書きする**項目 */
export const REPLACE_SETS = ["src", "thumbSrc", "dominantColor", "blurDataURL"] as const;

export type ReplaceBody = {
    key?: unknown;
    publicUrl?: unknown;
    thumbUrl?: unknown;
    exif?: unknown;
    date?: unknown;
    coords?: unknown;
    dominantColor?: unknown;
    blurDataURL?: unknown;
};

/**
 * 受け取ってよい差し替えか。駄目な理由を返す（null なら通す）。
 *
 * **判定は `savePhoto` と同じもの**を使う（`isOwnUploadUrl` ＋ 接頭辞 ＋ `..`）。
 * 写し直すと片方だけ緩くなる——あちらのコメントが、緩かった頃に
 * 「他人の写真のURLを自分の src にでき、消すと相手の実体が S3 から消えた」
 * と書いている。
 *
 * ⚠️ **形は同じでも `key` の役割は違う。** `savePhoto` では `key` が写真IDの素
 * （`idFromUploadKey`）で、そこが「IDを選び放題にしない」を担っている。
 * こちらは**検証するだけ**で、`buildReplace` も削除も見ていない。
 * 「鍵も検証されているから安全」とは読まないこと。
 *
 * ⚠️ **塞げていない筋（記録）**: `publicUrl` に**自分の別の写真がいま使って
 * いる**実体を指定できる。2つの行が同じ S3 実体を指し、片方を消す／差し替えると
 * もう片方が割れる。`savePhoto` は「IDを鍵から導出する」で塞いでいるが、
 * こちらで塞ぐには他の行を引く必要がある。自傷のみ・画面からは起こせない
 * （画面は presign で採った鍵しか送らない）ので、いまは記録に留める。
 */
export function replaceRefusal(body: ReplaceBody, userId: string): string | null {
    const { key, publicUrl } = body;
    if (typeof key !== "string" || typeof publicUrl !== "string" || !key || !publicUrl) {
        return "ファイル情報が必要です";
    }
    if (!isOwnUploadUrl(publicUrl, userId)) return "不正な画像URLです";
    if (!key.startsWith(uploadPrefix(userId)) || key.includes("..")) return "不正なキーです";
    return null;
}

/**
 * 差し替えで書く値と消す項目を組み立てる（**DynamoDB を触らない純関数**）。
 *
 * `cdnUrl` は保存する URL の土台（`canonicalUploadUrl` に渡す）。
 * 検証したときに見ていた形で保存する——生のまま保存すると、削除や
 * 派生生成で見る側と表記が食い違い、掃除の対象から漏れる余地が残る。
 */
export function buildReplace(body: ReplaceBody, userId: string, cdnUrl: string): {
    sets: Record<string, unknown>;
    clears: readonly string[];
} {
    const sets: Record<string, unknown> = {
        src: canonicalUploadUrl(String(body.publicUrl), cdnUrl),
    };
    // サムネは `publicUrl` と**まったく同じ判定**を通す（`savePhoto` と同じ理由
    // ——「https で始まる」しか見ていなかった頃は、外部の任意URLを入れて
    // ギャラリーを見た人全員の IP を集められた）
    if (isOwnUploadUrl(body.thumbUrl, userId) && String(body.thumbUrl).length <= 500) {
        sets.thumbSrc = canonicalUploadUrl(String(body.thumbUrl), cdnUrl);
    }
    const color = typeof body.dominantColor === "string" && /^#[0-9a-fA-F]{6}$/.test(body.dominantColor)
        ? body.dominantColor.toLowerCase() : undefined;
    if (color) sets.dominantColor = color;
    const blur = sanitizeBlurDataURL(body.blurDataURL);
    if (blur) sets.blurDataURL = blur;
    // **EXIF・撮影日・座標は「新しい写真から読めた分」で置き換える。**
    // これがこの機能の目的そのもの。読めなければ触らない——古い写真の
    // EXIF を消すためではなく、新しい写真の EXIF を入れるための操作なので
    const exif = sanitizeExif(body.exif);
    if (exif) sets.exif = exif;
    const date = sanitizeDate(body.date);
    if (date) sets.date = date;
    const coords = sanitizeCoords(body.coords);
    if (coords) sets.coords = coords;

    // **送った項目は消さない。** `thumbSrc` を送らなかった回だけビルドに
    // 作らせる（`REPLACE_SETS` のうち送られなかったものは消して、
    // ビルドの「空なら埋める」に拾わせる）
    const clears = [
        ...REPLACE_CLEARS,
        ...REPLACE_SETS.filter((f) => !(f in sets)),
    ];
    return { sets, clears };
}
