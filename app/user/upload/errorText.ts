import { userFacingError } from "../../../lib/utils/errorText";

/** 画面に出してよい失敗の文言（技術文字列を出さないための境界） */
export const UPLOAD_FAILED_MESSAGE = "画像をアップロードできませんでした。時間をおいてもう一度お試しください";

/**
 * 例外を、画面に出してよい文言に変える。
 *
 * 規則そのものは `lib/utils/errorText.ts` に移した（同じ事故を
 * ストーリー削除でもう一度作ったため）。ここはアップロード用の
 * 既定文言を添えるだけ。
 *
 * page.tsx から切り出してあるのは、そこを import すると Next のページ
 * ごと読み込むことになり、単体で確かめられないため。
 */
export function userFacingUploadError(err: unknown): string {
    return userFacingError(err, UPLOAD_FAILED_MESSAGE);
}
