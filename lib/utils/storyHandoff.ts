/**
 * 「投稿する」（`PostSheet`）で選んだストーリー用のファイルを、`StoriesBar` の投稿の流れへ渡す。
 *
 * ファイルの選択はユーザー操作の中でしか開けない（`input.click()` は
 * ジェスチャ無しではブラウザが止める）ので、**選ぶのはシートの側**で、下ごしらえ・
 * キャプション・曲・投稿は `StoriesBar` の既存の流れに乗せる。
 *
 * - バーが描かれていれば（トップ）その場で渡す
 * - 描かれていなければ（別のページ）預けておき、トップへ移った `StoriesBar` が
 *   マウント時に受け取る。**預かるのは1件だけ**（後から来た方が勝つ）
 */
type Listener = (file: File) => void;

let pending: File | null = null;
const listeners = new Set<Listener>();

/** 渡せたら true（バーが受け取った）。false なら預けたので、トップへ移ること */
export function handOffStoryFile(file: File): boolean {
    if (listeners.size > 0) {
        for (const fn of listeners) fn(file);
        return true;
    }
    pending = file;
    return false;
}

/** 預かっている1件を取り出す（取り出したら空になる） */
export function takeHandedStoryFile(): File | null {
    const f = pending;
    pending = null;
    return f;
}

/** バーが「受け取れる」間だけ登録する。解除の関数を返す */
export function onStoryFileHandoff(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

/** テスト用: 預かり分と購読を全部捨てる */
export function resetStoryHandoff(): void {
    pending = null;
    listeners.clear();
}
