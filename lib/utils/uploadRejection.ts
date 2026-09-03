import { UnstrippableFileError } from "./image";

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
 * 同じ文字列が5か所に複製されていたので、ここに1つだけ置く
 * （複製した規則は静かにずれる、がこの台帳の型2）。
 */
export function unstrippableMessage(err: unknown, locale: string): string {
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
