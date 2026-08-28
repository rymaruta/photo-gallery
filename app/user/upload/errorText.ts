/** 画面に出してよい失敗の文言（技術文字列を出さないための境界） */
export const UPLOAD_FAILED_MESSAGE = "画像をアップロードできませんでした。時間をおいてもう一度お試しください";

/**
 * 例外を、画面に出してよい文言に変える。
 *
 * ここが無かったので `err.message` をそのまま描画していて、「S3 403」や
 * オフライン時の "Failed to fetch" が画面に出ていた。サーバーが日本語で
 * 返した理由（readApiError 経由。「写真は100枚までです」など、押し直しても
 * 直らないもの）はそのまま出したいので、**日本語が含まれるものだけ通す**。
 *
 * page.tsx から切り出してあるのは、そこを import すると Next のページ
 * ごと読み込むことになり、単体で確かめられないため。
 */
export function userFacingUploadError(err: unknown): string {
    const msg = err instanceof Error ? err.message : "";
    if (!msg) return UPLOAD_FAILED_MESSAGE;
    return /[ぁ-んァ-ヶ一-龠]/.test(msg) ? msg : UPLOAD_FAILED_MESSAGE;
}
