/**
 * 例外を、画面に出してよい文言に変える（技術文字列を出さないための境界）。
 *
 * これが無いと `err.message` をそのまま描画してしまい、「S3 403」や
 * オフライン時の "Failed to fetch"（Safari は "Load failed"）が画面に出る。
 * 一方で、サーバーが日本語で返した理由（`readApiError` 経由。
 * 「写真は100枚までです」「画像の削除を完了できませんでした…」など、
 * 押し直しても直るとは限らないもの）はそのまま出したい。
 *
 * そこで**日本語が含まれるものだけ通す**。この規則は元々アップロード画面
 * だけに置いてあったが、同じ事故（英語の技術文字列が画面に出る）を
 * ストーリー削除でもう一度作ったので、共有の場所へ出した。
 *
 * サーバーの文言が日本語固定なのは方針（台帳 POL-1）。多言語対応する
 * ときは、この判定ごと `readApiError` に locale を渡す設計へ移す。
 */
export function userFacingError(err: unknown, fallback: string): string {
    const msg = err instanceof Error ? err.message : "";
    if (!msg) return fallback;
    return /[ぁ-んァ-ヶ一-龠]/.test(msg) ? msg : fallback;
}
