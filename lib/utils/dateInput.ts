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
    const t = Date.parse(original);
    if (Number.isNaN(t)) return input;
    if (new Date(t).toISOString().slice(0, 10) !== input) return input;
    // 元の日付と同じ。時刻を保つ——ただし「UTC 0時ちょうど」は、
    // 旧 sanitizeDate が日付だけの入力に付けていた**捏造の時刻**（C-12）。
    // 保つ価値が無いどころか、ここで返し続けると「日付を変えない再保存」が
    // 永久に移行されない。日付だけに直して返す。
    // ※本物の UTC 0時（JST 9:00:00 ちょうど等）も巻き添えで日付だけになるが、
    //   EXIF は秒精度なので1枚あたり 1/86,400。許容する。
    if (original.endsWith("T00:00:00.000Z")) return input;
    return original;
}
