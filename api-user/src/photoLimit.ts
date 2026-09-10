import { countUserPhotos } from "./ddb-photos";
import { JSON_HEADERS } from "./http";

/**
 * 1人あたりのアップロード上限。**lib/utils/uploadLimits.ts と対**
 * （クライアントからこのパッケージは import できないので数字を2か所に持つ。
 * `scripts/__tests__/limitParity.test.ts` が突き合わせる）。
 *
 * 2026-09-09 に 100 → 1000 へ（owner の判断）。100 は「1日3枚で33日」で
 * 頭打ちになる数字で、たくさん投稿してほしいという方針と逆向きだった。
 * **一覧はまだ全件を返す**ので、300〜500枚に近づく前にページングが要る。
 */
export const PHOTO_LIMIT_PER_USER = 1000;

/**
 * アップロードの上限（PHOTO_LIMIT_PER_USER）を確かめる。超えていれば断る理由を返す。
 *
 * **数えられなかったら通さない。** 以前は console.error だけ出して
 * そのまま保存していたので、スロットリングを起こせば上限を超えられた。
 * これは容量と費用の上限なので、「分からないなら通す」ではなく
 * 「分からないなら止める」に倒す
 * （CLAUDE.md の「設定ミスは『本番を触る』ではなく『動かない』に倒す」と同じ）。
 *
 * 入口が2つある（presignedUrl と savePhoto）ので、判定はここ1か所に置く。
 * 片方だけ直しても、もう片方から素通りする。
 */
export async function photoLimitError(userId: string, admin: boolean) {
    if (admin) return null;
    let count: number;
    try {
        count = await countUserPhotos(userId);
    } catch (e) {
        console.error("photo count check error:", e);
        return {
            statusCode: 503,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: "枚数を確認できませんでした。時間をおいてもう一度お試しください" }),
        };
    }
    if (count >= PHOTO_LIMIT_PER_USER) {
        return {
            statusCode: 403,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: `アップロード上限（${PHOTO_LIMIT_PER_USER}枚）に達しています` }),
        };
    }
    return null;
}
