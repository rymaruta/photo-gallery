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


// ── v2 の撮影情報の1行（板 `PhotoDetail.dc.html`・アプリの `PhotoMetaLine`）──────────

/** 板の区切り（` · `） */
const SEP = " · ";

type ExifLineSource = {
    camera?: string;
    lens?: string;
    aperture?: string;
    exposure?: string;
    iso?: number | string;
    focalLength?: string;
} | null | undefined;

const trimmed = (v: unknown): string | undefined => {
    const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v.trim() : "";
    return s ? s : undefined;
};

/** 絞り。`f/` の付かない値（"8"）にも付ける（アプリの `PhotoMetaLine.aperture` と同じ） */
function apertureText(v: unknown): string | undefined {
    const s = trimmed(v);
    if (!s) return undefined;
    return s.toLowerCase().startsWith("f") ? s : `f/${s}`;
}

/**
 * シャッター。**板の書き方「1/125 s」にそろえる**（数字と単位の間に空き）。
 * 保存されている値は Web が "1/125s"、アプリが "1/125"（秒の s が無い）で割れているので、
 * 末尾の s を一度外してから付け直す
 */
function exposureText(v: unknown): string | undefined {
    const s = trimmed(v);
    if (!s) return undefined;
    const bare = s.replace(/\s*(s|sec|秒)$/i, "").trim();
    return bare ? `${bare} s` : undefined;
}

/** ISO。0 以下・数でないものは出さない（「ISO 0」を作らない） */
function isoText(v: unknown): string | undefined {
    const s = trimmed(v);
    if (!s) return undefined;
    const n = Number(s.replace(/^iso\s*/i, ""));
    return Number.isFinite(n) && n > 0 ? `ISO ${n}` : undefined;
}

/**
 * 撮影設定の1行「24mm · f/8 · 1/125 s · ISO 100」（焦点距離 → 絞り → シャッター → ISO）。
 * **持っているものだけを繋ぐ**——空の欠片に区切りだけが残る行を作らない。何も無ければ `undefined`
 */
export function exifSettingsLine(exif: ExifLineSource): string | undefined {
    if (!exif) return undefined;
    const items = [trimmed(exif.focalLength), apertureText(exif.aperture), exposureText(exif.exposure), isoText(exif.iso)]
        .filter((s): s is string => !!s);
    return items.length > 0 ? items.join(SEP) : undefined;
}

/**
 * 機材の1行「SONY ILCE-7M3 · E 28-200mm」（機種 · レンズ）。何も無ければ `undefined`。
 *
 * **機種の二重のメーカー名は呼ぶ側で畳んで渡す**（`dedupeCameraName`）。このファイルは
 * 何も import しない決まり（`exifr` を写真ページの初期バンドルに戻さないための見張りが
 * `__tests__/exifDisplay.test.ts` にある）
 */
export function exifGearLine(exif: ExifLineSource): string | undefined {
    if (!exif) return undefined;
    const items = [trimmed(exif.camera), trimmed(exif.lens)].filter((s): s is string => !!s);
    return items.length > 0 ? items.join(SEP) : undefined;
}
