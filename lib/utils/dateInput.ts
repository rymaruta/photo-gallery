// <input type="date"> と保存値（ISO文字列）の橋渡し。
//
// 保存値は "2026-05-03T10:22:00.000Z" のような ISO 文字列だが、
// <input type="date"> は "YYYY-MM-DD" しか受け付けず、それ以外を渡すと
// 黙って空欄になる。空欄を見た人が「撮影日が入っていない」と誤解して
// 日付を選び直すと、今度は時刻が落ちて同じ日の写真の並びが崩れる。
// 読むときと書くときで対になる処理なので、1か所にまとめる。

/** ISO 文字列を <input type="date"> が受け付ける YYYY-MM-DD にする */
export function toDateInputValue(raw?: string): string {
    if (!raw) return "";
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
    if (m) return m[1];
    const t = Date.parse(raw);
    if (Number.isNaN(t)) return "";
    return new Date(t).toISOString().slice(0, 10);
}

/**
 * 入力された日付（YYYY-MM-DD）に、元の値が持っていた時刻を戻す。
 * 日付だけを編集させているのに時刻まで落とすと、同じ日に撮った写真の
 * 並び順が崩れるため。
 */
export function mergeDate(original: string | undefined, input: string): string {
    if (!input) return "";
    if (!original) return input;
    // **同じ日かどうかは、文字列の先頭で見る。**
    // `Date.parse` + `toISOString` で比べていた頃は、**ゾーン指定の無い
    // 日時を端末のゾーンで解釈**していた（ES の仕様。日付だけは UTC、
    // 日時はローカル）。EXIF 由来の撮影日時はまさにその形
    // （`exifWallClock` が「書いてあるとおりの壁時計」で保存する——
    // `toISOString` だと端末のゾーンぶんずれるから、というのがあの関数の
    // 存在理由）なので、日本で朝に撮った写真（00:00〜08:59）や
    // ニューヨークで夜に撮った写真（19:00〜23:59）は UTC で別の日になり、
    // **日付を1文字も触っていない保存で時刻が落ちていた**（実測）。
    // 落ちると同じ日に撮った写真の並び順が変わる。
    // `toDateInputValue` は入力欄に出す値そのものなので、
    // 「欄に出したのと同じ日か」を見ることになり、ゾーンに依存しない。
    if (!toDateInputValue(original)) return input;
    if (toDateInputValue(original) !== input) return input;
    // 元の日付と同じ。時刻を保つ——ただし「UTC 0時ちょうど」は、
    // 旧 sanitizeDate が日付だけの入力に付けていた**捏造の時刻**（C-12）。
    // 保つ価値が無いどころか、ここで返し続けると「日付を変えない再保存」が
    // 永久に移行されない。日付だけに直して返す。
    // ※本物の UTC 0時（JST 9:00:00 ちょうど等）も巻き添えで日付だけになるが、
    //   EXIF は秒精度なので1枚あたり 1/86,400。許容する。
    if (original.endsWith("T00:00:00.000Z")) return input;
    return original;
}

/**
 * 撮影日として保存できる一番古い日。サーバー（両パッケージの `sanitizeDate`）が
 * 1990年より前を断るので、入力欄にも同じ下限を出す。
 * **数字を書き写しているので、`scripts/__tests__/limitParity.test.ts` と同じ形で
 * サーバー側の値と突き合わせる**（片方だけ動かすと、入れられるのに保存できない
 * ——または、入れられないのに保存はできる——が生まれる）。
 */
export const PHOTO_DATE_MIN = "1990-01-01";

/**
 * `<input type="date">` の `max` に入れる「今日」。サーバーは「今から24時間先」まで
 * 許すが、画面では今日までにしておく（時差で1日ぶれる端末があっても、
 * サーバーが断らない範囲に収まる）。
 */
export function todayForDateInput(now: Date = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
