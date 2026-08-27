// 「実際に変わった項目だけを送る」ための小さな比較。
//
// 写真の編集画面（/user/edit・/admin/edit）は、開いた時点の値を毎回
// **全項目**送っていた。サーバー（api-user/src/photoUpdate.ts）は部分更新
// なのに、こちらが全部送れば結局は全置換と同じで、同じ写真を2タブで開いて
// 片方で直したあと、もう片方で保存すると**先の編集が黙って消えた**。
// 写真の更新には rev のような楽観ロックが無い（プロフィールにはある）ので、
// 送る側で絞るのが今できる確実な守り。

/**
 * 保存前の値と、送ろうとしている値が同じか。
 *
 * 空文字と未設定（undefined / null）は同じ扱いにする——読み込み時に
 * `?? ""` で埋めているので、触っていない項目が「クリアした」と
 * 誤解されないようにするため。空文字を**明示的に**入れてクリアする操作は、
 * 元の値が非空なら差分として検出される。
 */
export function sameFieldValue(next: unknown, prev: unknown): boolean {
    const norm = (v: unknown) => (v === undefined || v === null || v === "" ? "" : v);
    return JSON.stringify(norm(next)) === JSON.stringify(norm(prev));
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
