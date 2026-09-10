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

/**
 * **保存済みの機材名から、二重になったメーカー名を落とす。**
 *
 * `formatCameraName` は Make と Model を持っているときの結合で、正しく動く。
 * ところが**それを使う前に保存された行**が残っていて、実データに
 * `"Hasselblad Hasselblad X2D II 100C"` が実在する（30枚中1機種）。
 * 保存された値をそのまま出している所が3つあり、訪問者が見るモーダルも
 * その1つだった。
 *
 * 直すのは**表示だけ**。入力欄（`/admin/edit`）には当てない——落とした値が
 * 保存の差分の比較先に入り、「利用者が消した」と読まれる
 * （プロフィールの曲で実際に踏んだ形）。
 *
 * 畳むのは**先頭のトークンがすぐ繰り返されている場合だけ**。
 * `"NIKON CORPORATION NIKON D850"` のような形（メーカー名が2語）は
 * 畳まない——実データに無く、確かめずに広げると正当な機種名を壊す側に倒れる。
 */
export function dedupeCameraName(camera?: string): string | undefined {
    const v = (camera ?? "").trim().replace(/\s+/g, " ");
    if (!v) return undefined;
    const sp = v.indexOf(" ");
    if (sp <= 0) return v;
    const first = v.slice(0, sp);
    const rest = v.slice(sp + 1);
    // 「先頭の語 + 空白」で始まっていれば、その1つぶんだけ落とす
    return rest.toLowerCase().startsWith(first.toLowerCase() + " ") ? rest : v;
}
