// 「実際に変わった項目だけを送る」ための比較。
//
// 写真の編集画面（/user/edit・/admin/edit）は、開いた時点の値を毎回
// **全項目**送っていた。サーバー（api-user/src/photoUpdate.ts）は部分更新
// なのに、こちらが全部送れば結局は全置換と同じで、同じ写真を2タブで開いて
// 片方で直したあと、もう片方で保存すると**先の編集が黙って消えた**。
// 写真の更新には rev のような楽観ロックが無い（プロフィールにはある）ので、
// 送る側で絞るのが今できる確実な守り。

/**
 * 「無い」と同じに扱う値。空文字・undefined・null に加えて、
 * **空の入れ物**（`[]`・`{}`・`{ja:[],en:[]}`）も含める。
 *
 * サーバーの sanitize は空の説明・空の exif・空のタグをキーごと落として
 * 保存する。畳まないと「保存されている姿（属性なし）」と「画面が組む姿
 * （空の容器）」が永久に一致せず、説明も EXIF も持たない写真を保存する
 * たびに **REMOVE 指定が飛ぶ**——別タブで書いた説明を消してしまう。
 */
function isBlank(v: unknown): boolean {
    if (v === undefined || v === null || v === "") return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "object") return meaningfulKeys(v as Record<string, unknown>).length === 0;
    return false;
}

/** 中身のある項目のキーだけ（空の項目は無いものとして数えない） */
function meaningfulKeys(o: Record<string, unknown>): string[] {
    return Object.keys(o).filter((k) => !isBlank(o[k]));
}

/**
 * 保存済みの値と、送ろうとしている値が同じか。
 *
 * **JSON 文字列の比較では足りない。** キーの順番は DynamoDB を通ると
 * 変わり得る——実データの title/description は `{en, ja}` 順で保存されて
 * いるのに、画面が組む値は `{ja, en}` 順。文字列で比べていた頃は
 * 30件すべてが毎回「変わった」と判定され、差分送信が主役の2項目で
 * 何も効いていなかった。サーバー側の sameStoredValue
 * （api-user/src/sanitize.ts）と同じ再帰の deep-equal にする。
 * **対の実装。片方を直したらもう片方も見ること。**
 *
 * 空文字・undefined・null は「無い」として同じ扱い（読み込み時に `?? ""` で
 * 埋めているので、触っていない項目が「クリアした」と誤解されないように）。
 */
export function sameFieldValue(a: unknown, b: unknown): boolean {
    if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b);
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((v, i) => sameFieldValue(v, b[i]));
    }
    if (typeof a === "object" && typeof b === "object") {
        const ao = a as Record<string, unknown>;
        const bo = b as Record<string, unknown>;
        // 空の項目（""・undefined・空配列）は「無い」と同じに畳む。
        // サーバーの sanitize が空の en やタグを落として保存するので、
        // 畳まないと「保存されている形」と「画面が組む形」が永久に一致しない。
        const ak = meaningfulKeys(ao);
        const bk = meaningfulKeys(bo);
        if (ak.length !== bk.length) return false;
        return ak.every((k) => k in bo && sameFieldValue(ao[k], bo[k]));
    }
    return false;
}

/** next のうち、prev と違う項目だけを取り出す */
export function changedFields(
    next: Record<string, unknown>,
    prev: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(next)) {
        if (!sameFieldValue(value, prev[key])) out[key] = value;
    }
    return out;
}
