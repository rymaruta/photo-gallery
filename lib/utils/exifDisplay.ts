// lib/utils/exifDisplay.ts
// 撮影情報を画面に出す形にする（`exifr` を引き込まない）。

/**
 * ホワイトバランスを画面に出す形にする。
 *
 * **日本語のラベルに英語の値が並んでいた。** 実ビルドで **25/30 の写真
 * ページ**が「ホワイトバランス: Manual」と出していた（検索の着地点）。
 * `a287ee3` が同じ理由で英語の操作ラベルを日本語にしたのと同じ形。
 *
 * **EXIF の WhiteBalance は規格上2値**（0=Auto / 1=Manual）で、exifr が
 * その文字列に起こす。**知らない値はそのまま返す**——機種が独自の文字列を
 * 書いていた場合に、こちらの都合で消さない。
 *
 * **置き場所は `exif.ts` ではない。** あちらは1行目で `exifr` を静的に
 * import しているので、この関数のために import すると**写真ページの初期
 * バンドルに exifr（73KB）が戻る**（`cameraName.ts` が切り出されているのと
 * 同じ理由。実際に一度そう書いて `tsc` で気づいた）。
 *
 * **表示のときだけ当てる。** 保存済みの値は英語のまま置く
 * （`/admin/edit` の入力欄に当てると、保存の差分の比較先が変わって
 * 「利用者が書き換えた」と読まれる——`dedupeCameraName` と同じ判断）。
 */
const WHITE_BALANCE_JA: Record<string, string> = { auto: "オート", manual: "マニュアル" };

export function displayWhiteBalance(v: string | undefined, locale: "ja" | "en" = "ja"): string | undefined {
    const raw = (v ?? "").trim();
    if (!raw) return undefined;
    if (locale === "en") return raw;
    return WHITE_BALANCE_JA[raw.toLowerCase()] ?? raw;
}

