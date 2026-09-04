import { UnstrippableFileError } from "./image";
import type { Locale } from "../data/photos";

/**
 * 「上げられない」と断るときの文言。
 *
 * **理由ごとに書き分ける。** 画面は5か所とも
 *
 *     この形式は安全にアップロードできません。JPEG か PNG で保存し直してください。
 *
 * の一文に潰していたが、`toUploadSafeFile` が断る理由は形式だけではない
 * ——「デコードできない」「画素が多すぎる」の場合は**形式は正しい JPEG** で、
 * 言われたとおり保存し直しても同じ結果になる（袋小路）。
 *
 * 同じ文字列が**4画面5か所**に複製されていたので、ここに1つだけ置く
 * （複製した規則は静かにずれる、がこの台帳の型2）。
 *
 * **訂正**: 一度「5か所のうち1か所だけ句点が違っていた」と書いたが誤り。
 * 日本語は5か所ともバイト一致で、ずれていたのは**英語**——アバターだけ
 * `Please save it as JPEG or PNG.`（`and try again.` が無い）だった。
 * 統合でそちらに合わせている。
 */
export function unstrippableMessage(err: unknown, locale: Locale): string {
    const reason = err instanceof UnstrippableFileError ? err.reason : "format";
    const en = locale === "en";
    if (reason === "undecodable") {
        return en
            ? "This image couldn't be opened. It may be corrupted or too large — please export it again at a smaller size."
            : "この画像を開けませんでした。壊れているか大きすぎます。小さいサイズで書き出し直してください。";
    }
    if (reason === "too-many-pixels") {
        return en
            ? "This image has too many pixels to process. Please export it at a smaller size."
            : "この画像は画素数が多すぎて扱えません。小さいサイズで書き出し直してください。";
    }
    return en
        ? "This format can't be uploaded safely. Please save it as JPEG or PNG and try again."
        : "この形式は安全にアップロードできません。JPEG か PNG で保存し直してください。";
}

/**
 * GIF を**選んだ時点で**断るときの文言。
 *
 * `toUploadSafeFile` は GIF を必ず `UnstrippableFileError` にする
 * （アニメーションを保つため再エンコードせず、保険のバイト除去は JPEG だけ）。
 * 投稿・保存まで待つと、プレビューとキャプションを作ってから必ず断られる。
 *
 * **画面ごとに別の文を書かない。** 一度、写真グリッドは
 * 「GIF は位置情報を取り除けない: cat.gif」、ストーリーは
 * 「GIF は位置情報を取り除けません。JPEG か PNG を選んでください。」と
 * 別々に書いてしまった（同じ判断なのに文が2つ）。
 */
export function gifRejectedMessage(locale: Locale): string {
    return locale === "en"
        ? "GIFs can't have their location data removed. Please choose a JPEG or PNG."
        : "GIF は位置情報を取り除けません。JPEG か PNG を選んでください。";
}

/** 複数ファイルの理由をまとめて出す画面（写真グリッド）が使う短い札 */
export function gifRejectedLabel(locale: Locale): string {
    return locale === "en" ? "GIF can't have its location data removed" : "GIF は位置情報を取り除けない";
}
