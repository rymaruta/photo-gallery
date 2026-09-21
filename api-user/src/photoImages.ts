import { canonicalUploadUrl, uploadPrefix, isOwnUploadUrlFromEnv as isOwnUploadUrl } from "./uploadPolicy";

/**
 * 1投稿に複数枚（owner の新デザインの「1/10」）。
 *
 * **`src` を配列にしない。** 表紙は今までどおり `src`（と その派生）で、
 * 2枚目以降だけを `extraImages` に持つ。理由:
 *
 * - 既存の写真は `extraImages` を持たないので**何も変わらない**（後方互換）
 * - 表紙が `src` のままなら、**og:image・サムネ・地図・サイトマップ・
 *   JSON-LD・削除・退会の掃除の入口を1つも書き換えずに済む**。配列に
 *   すると「1枚目」を取り出す式が十数か所に散る
 * - 派生（`thumbSrc`/`srcAvif`/`width`/`blurDataURL`…）は1枚ごとに要るので、
 *   `extraImages` の要素も同じ形を持つ
 */
export type PhotoImage = {
    src: string;
    srcAvif?: string;
    thumbSrc?: string;
    thumbAvif?: string;
    thumbSm?: string;
    thumbSmAvif?: string;
    width?: number;
    height?: number;
    dominantColor?: string;
    blurDataURL?: string;
};

/**
 * 2枚目以降の上限。**表紙と合わせて10枚**（モックの「1/10」）。
 *
 * 画面側の上限と食い違わないことは `app/__tests__/limitParity.test.ts` が見る。
 */
export const EXTRA_IMAGES_MAX = 9;

/** 1投稿ぶんの総枚数の上限（表紙 + `extraImages`）。画面の「N/10」はこれ */
export const PHOTO_IMAGES_MAX = EXTRA_IMAGES_MAX + 1;

/**
 * ビルドが作る派生。**`scripts/generate-thumbnails.js` が埋める側**なので、
 * 利用者が送り直しても消してはいけない（同じ `src` の既存要素から引き継ぐ）。
 *
 * 上位の `SERVER_OWNED_FIELDS`（`upload.ts`）と同じ考えだが、
 * あちらは行の属性、こちらは**配列の要素ごと**。鍵は `src`。
 */
const DERIVED_FIELDS = [
    "srcAvif", "thumbSrc", "thumbAvif", "thumbSm", "thumbSmAvif",
    "width", "height", "dominantColor", "blurDataURL",
] as const;

/** 代表色: `#rrggbb` だけ受ける（`upload.ts` の表紙と同じ判定） */
function safeColor(v: unknown): string | undefined {
    return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined;
}

/**
 * 受け取った2枚目以降を、**表紙とまったく同じ厳しさ**で確かめる。
 *
 * 表紙（`savePhoto` の `publicUrl`）が通っている検査を1つも緩めない:
 *
 * - `isOwnUploadUrl`（投稿者ごとの接頭辞まで）——**これが無いと、他人の
 *   写真のURLを自分の投稿の2枚目に入れられ、自分の投稿を消したときに
 *   相手の実ファイルが S3 から消える**（表紙で一度踏んだ穴）
 * - `..` を含む鍵は弾く
 * - 長さ 500 まで
 * - 保存するのは `canonicalUploadUrl` を通した形（削除や派生生成で見る側と
 *   表記が食い違い、対象から漏れる余地を残さない）
 *
 * **表紙と同じ `src` は落とす**（同じ実体を2回並べない＝削除で片方が
 * 割れる形を作らない）。重複も落とす。
 *
 * @param input 本文の `extraImages`（信用しない）
 * @param userId 投稿者。接頭辞の検査に使う
 * @param cdnUrl `canonicalUploadUrl` の土台
 * @param coverSrc 表紙の**揃えたあと**の URL（重複を落とすため）
 * @returns 1枚以上あれば配列、無ければ `undefined`（属性ごと持たない）
 */
export function sanitizeExtraImages(
    input: unknown, userId: string, cdnUrl: string, coverSrc: string,
): PhotoImage[] | undefined {
    if (!Array.isArray(input)) return undefined;
    const out: PhotoImage[] = [];
    const seen = new Set<string>([coverSrc]);
    for (const raw of input) {
        if (out.length >= EXTRA_IMAGES_MAX) break;
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;

        const publicUrl = r.src;
        const key = r.key;
        if (typeof publicUrl !== "string" || publicUrl.length > 500) continue;
        if (!isOwnUploadUrl(publicUrl, userId)) continue;
        // 鍵も送られていれば、表紙と同じ形で確かめる（送られていなければ
        // URL 側の検査だけ。表紙は鍵を必須にしているが、あちらは鍵から
        // 写真の ID を導くため——2枚目以降に ID は要らない）
        if (typeof key === "string"
            && (!key.startsWith(uploadPrefix(userId)) || key.includes(".."))) continue;

        const src = canonicalUploadUrl(publicUrl, cdnUrl);
        if (seen.has(src)) continue;
        seen.add(src);

        const img: PhotoImage = { src };
        // サムネは表紙と同じ判定（外部の任意URLを入れて閲覧者の IP を
        // 集める・他人の uploads/ を指す、を両方塞ぐ）
        if (typeof r.thumbSrc === "string" && r.thumbSrc.length <= 500
            && isOwnUploadUrl(r.thumbSrc, userId)) {
            img.thumbSrc = canonicalUploadUrl(r.thumbSrc, cdnUrl);
        }
        const c = safeColor(r.dominantColor);
        if (c) img.dominantColor = c;
        // 寸法は正の有限な数だけ（レイアウトの予約に使う）
        for (const k of ["width", "height"] as const) {
            const n = r[k];
            if (typeof n === "number" && Number.isFinite(n) && n > 0) img[k] = Math.round(n);
        }
        out.push(img);
    }
    return out.length > 0 ? out : undefined;
}

/**
 * 保存の再送で、**ビルドが作った派生を落とさない**。
 *
 * 利用者が送り直すのは `src`（と、クライアントが作れるサムネ・代表色）だけ
 * なので、そのまま書くと `srcAvif` などが消える。同じ `src` の既存要素から
 * 引き継ぐ。**今回の本文にある項目は今回が勝つ**（上位の再送と同じ規則）。
 */
export function mergeExtraImages(
    next: PhotoImage[] | undefined, existing: unknown,
): PhotoImage[] | undefined {
    if (!next || next.length === 0) return next;
    if (!Array.isArray(existing)) return next;
    const bySrc = new Map<string, Record<string, unknown>>();
    for (const e of existing) {
        if (e && typeof e === "object" && typeof (e as { src?: unknown }).src === "string") {
            bySrc.set((e as { src: string }).src, e as Record<string, unknown>);
        }
    }
    return next.map((img) => {
        const prev = bySrc.get(img.src);
        if (!prev) return img;
        const merged: Record<string, unknown> = { ...img };
        for (const k of DERIVED_FIELDS) {
            if (merged[k] === undefined && prev[k] !== undefined) merged[k] = prev[k];
        }
        return merged as PhotoImage;
    });
}

/**
 * `extraImages` が持つ**すべての**画像 URL（派生を含む）。
 *
 * 削除の列挙（`mediaKeys` と `api/src/photosMutate.ts`）が使う。
 * **ここを足し忘れると、投稿を消しても2枚目以降の実体が公開URLに残る**
 * ——`srcOriginal` で一度踏んだ形の再発になる。
 */
export function extraImageUrls(extraImages: unknown): string[] {
    if (!Array.isArray(extraImages)) return [];
    const urls: string[] = [];
    for (const e of extraImages) {
        if (!e || typeof e !== "object") continue;
        const r = e as Record<string, unknown>;
        for (const k of ["src", ...DERIVED_FIELDS] as const) {
            const v = r[k];
            if (typeof v === "string" && v) urls.push(v);
        }
    }
    return urls;
}
