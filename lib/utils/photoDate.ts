/**
 * 写真の日時を「保存されている通り」に整える。
 *
 * **`toLocaleString` を描画中に使わない。** 使っていた頃は2つ壊れていた:
 *
 *  1. ハイドレーション不一致
 *     静的書き出しのビルドは UTC で走り、閲覧者は各自のゾーンで描き直す。
 *     同じノードの文字列が食い違うので、全写真ページで React が警告を出し、
 *     その部分を捨てて描き直していた。
 *
 *  2. 日付が1日ずれる
 *     保存されている撮影日は `"2024-10-12"` という**日付だけ**の形で、
 *     `new Date()` はこれを UTC 0時として読む。そこにローカル時刻の
 *     整形を当てると、UTC より西の閲覧者（ニューヨークは UTC−5）には
 *     **2024年10月11日**と表示される。
 *
 * 撮影日時は「その土地で撮った時刻」であって、閲覧者のゾーンに
 * 変換すべき値ではない。書かれている通りに出す。
 * 年表側（app/users/UserProfileClient.tsx）が UTC で切っているのと同じ立場。
 */

type Parts = { y: number; m: number; d: number; hh?: number; mm?: number };

/** ISO 8601 風の文字列を、変換せずに成分へ分解する（不正なら null） */
export function splitStoredDate(value: unknown): Parts | null {
    if (typeof value !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value.trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    // 時刻は「書かれていれば」出す。日付だけの値に 00:00 を足さない
    // （8枚しか撮影日を持たない今、残りは createdAt が使われていて、
    // そこには本来無い「0時ちょうど」が並んでいた）。
    if (m[4] === undefined) return { y, m: mo, d };
    const hh = Number(m[4]), mm = Number(m[5]);
    if (hh > 23 || mm > 59) return { y, m: mo, d };
    return { y, m: mo, d, hh, mm };
}

/** 英語の月名。年表の見出しでも使う（同じ並びを2か所に持たない） */
export const EN_MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

/** 撮影日時の表示文字列。整形できなければ null（＝その行を出さない） */
export function formatStoredDateTime(value: unknown, locale: "ja" | "en"): string | null {
    const p = splitStoredDate(value);
    if (!p) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    const time = p.hh === undefined ? "" : ` ${pad(p.hh)}:${pad(p.mm ?? 0)}`;
    return locale === "en"
        ? `${EN_MONTHS[p.m - 1]} ${p.d}, ${p.y}${time}`
        : `${p.y}年${p.m}月${p.d}日${time}`;
}

/**
 * 撮影日時の短い1行「2026.09.23 · 14:29」（iOS の `PhotoMetaLine.stamp`・2026-10-21）。
 * 写真ページの題の下に出す。数字は等幅の数字で組む（呼ぶ側が `tabular-nums`）。
 *
 * **日付は `date`（撮影日）。時刻はカメラが書いた撮影時刻（EXIF）を先に見る。**
 * EXIF に時刻が無い写真だけ、`date` に付いている時刻で出す（直す前の画面はこれを出していた・
 * 2026-10-21 の見直し）。
 *
 * EXIF の日付が `date` と食い違うときは**時刻を出さない**——持ち主が撮影日を
 * 直した写真に、別の日の時刻を添えることになる（`date` の時刻にも落とさない）。
 * `date` が無ければ EXIF の日付で出す。
 *
 * EXIF の値は3通り来る: 保存済みの `2024-10-12T09:00:00`、アプリが送る生の
 * `2024:10:12 09:00:00`、画面で抜いた `Date`（exifr はカメラの壁時計を
 * 端末の時刻として読むので、端末の時刻の部品で読み戻す）。
 * 読めなければ null（＝その行を出さない）。言語で書式は変えない（iOS と同じ）
 */
export function formatPhotoStamp(date: unknown, exifDateTime: unknown): string | null {
    const exif = splitExifDateTime(exifDateTime);
    const day = splitStoredDate(date) ?? exif;
    if (!day) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    let line = `${day.y}.${pad(day.m)}.${pad(day.d)}`;
    const sameDay = !!exif && exif.y === day.y && exif.m === day.m && exif.d === day.d;
    // EXIF が別の日を言うなら、どちらの時刻も添えない
    const clock = exif && exif.hh !== undefined
        ? (sameDay ? exif : null)
        : (exif && !sameDay ? null : day);
    if (clock && clock.hh !== undefined) line += ` · ${pad(clock.hh)}:${pad(clock.mm ?? 0)}`;
    return line;
}

/** EXIF の撮影日時（文字列2通りか `Date`）を成分へ。読めなければ null */
export function splitExifDateTime(value: unknown): Parts | null {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate(), hh: value.getHours(), mm: value.getMinutes() };
    }
    if (typeof value !== "string") return null;
    // EXIF の生の形（`2024:10:12 09:00:00`）は区切りを `-` に直してから同じ読み方で
    return splitStoredDate(value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"));
}
