/**
 * いまの URL のクエリ文字列を `useSyncExternalStore` で読むための3点。
 *
 * **`useGallery` と `BottomNav` が共有する。** `history` を包むのは1度だけ
 * （`patchHistoryOnce`）で、2か所に同じ包みを書くと二重に包まれる。
 * 下の注記は `useGallery` にあったものをそのまま移した。
 */

/**
 * いまの URL のクエリ文字列。**`useSyncExternalStore` で読む。**
 *
 * 🔴 **これが無いと、`<Link>` で飛んだ行き先の絞り込みが落ちる。**
 * 実測（2026-09-23・本番と同じ環境変数のビルドを実ブラウザで・`history` の
 * 呼び出しを全部記録した）:
 *
 *     1889.6ms  pushState     /search?category=landscape   ← Next の <Link>
 *     1953.2ms  replaceState  /search                      ← 下の同期が消す
 *
 * **URL は一度は正しくなっている。** 消していたのはこのフック自身だった
 * ——`urlFilters` の依存が `[clientRender]` だけで、**水和のときに一度
 * 読んだきり二度と読み直さない**ので、行き先のクエリを知らないまま
 * 空の絞り込みを書き戻していた。
 *
 * `getSnapshot` は**描画のたびに読み直される**ので、`<Link>` の遷移
 * （`pushState` → 描画）はこれで拾える。購読が要るのは「こちらが描き直さない
 * のに URL だけ変わる」場合＝**戻る・進む**（`popstate`）。
 *
 * ⚠️ **`useSearchParams()` は使えない。** 静的書き出しでは Suspense に
 * 包む必要があり、事前描画で焼かれるのは fallback なので**トップの静的HTML
 * が空になる**。実測: `out/index.html` 261,753 → 50,039 バイト／
 * 写真カードのリンク 30 → 0／`<h1>` 2 → 0。このサイトで最も強い索引対象の
 * ページなので採れない。
 */
/**
 * `pushState` / `replaceState` は**イベントを出さない**ので、購読するには
 * 1度だけ包むしかない。**元の関数は必ず呼び、戻り値もそのまま返す**
 * （振る舞いは1つも変えない。足すのは「変わったと知らせる」だけ）。
 *
 * ⚠️ 戻るのに `popstate` だけでは足りないことが実測で分かっている——
 * `<Link>` の遷移は **描画のあとに `pushState`** する（記録した順:
 * 行き先の描画 → `pushState`）ので、描画のときに読む `getSnapshot` は
 * 前の URL を見る。知らせが来なければそのまま固まる。
 */
const urlListeners = new Set<() => void>();
let historyPatched = false;
function patchHistoryOnce(): void {
    if (historyPatched || typeof window === "undefined") return;
    historyPatched = true;
    for (const key of ["pushState", "replaceState"] as const) {
        const original = window.history[key].bind(window.history);
        window.history[key] = function patched(...args: Parameters<History["pushState"]>) {
            const result = original(...args);
            for (const notify of [...urlListeners]) notify();
            return result;
        };
    }
}

export const subscribeToUrl = (onChange: () => void) => {
    patchHistoryOnce();
    urlListeners.add(onChange);
    window.addEventListener("popstate", onChange);
    return () => {
        urlListeners.delete(onChange);
        window.removeEventListener("popstate", onChange);
    };
};
export const readSearch = () => window.location.search;
export const readSearchOnServer = () => "";
