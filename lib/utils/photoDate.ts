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
