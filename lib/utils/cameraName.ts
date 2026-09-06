/**
 * Make と Model を重複なく結合（"SONY" + "SONY ILCE-7M3" → "SONY ILCE-7M3"）。
 *
 * `exif.ts` から切り出したのは、あちらが先頭で `exifr` を import しているため。
 * 写真ページは exifr を遅延読み込みにしている（初期バンドルに入れない）ので、
 * この関数だけ欲しくて `exif.ts` を import すると exifr ごと引き込む。
 */
export function formatCameraName(make?: string, model?: string): string | undefined {
    const mk = (make ?? "").trim();
    const md = (model ?? "").trim();
    if (!mk && !md) return undefined;
    if (!md) return mk;
    if (!mk || md.toLowerCase().startsWith(mk.toLowerCase())) return md;
    return `${mk} ${md}`;
}
