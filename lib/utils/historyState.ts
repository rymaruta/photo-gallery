// lib/utils/historyState.ts
//
// 履歴（`history.pushState` / `replaceState`）を書くときの共通の作法。

/**
 * 履歴の state を書くときに、**Next の内部キーを持ち越す**。
 *
 * `replaceState({}, ...)` で潰していたので、そのエントリに戻ると Next の
 * popstate ハンドラが `if (!event.state.__NA) window.location.reload()`
 * （`app-router.js`）に落ちる——**ページが丸ごと再読み込みされ、一覧の
 * スクロール位置が消える**。モーダルを閉じるたびにそれが起きていた
 * （`e6aa8c7` で `back()` を呼ぶようにして初めて表に出た。潰し自体は
 * それ以前からあった）。Next 自身も `copyNextJsInternalHistoryState` で
 * 同じことをしている。
 *
 * **`useGallery` の中に private で置いていたのを、ここへ出した**
 * （2026-09-22）。撮影スポット詳細のビューアも履歴を1件積む必要があり、
 * この教訓を写すと**片方だけ直したときに静かにずれる**——潰した側は
 * 「戻ると再読み込みされる」という、その場では気づけない壊れ方をする。
 */
export function withNextHistoryState(extra: Record<string, unknown>): Record<string, unknown> {
    const cur = (typeof window !== "undefined" ? window.history.state : null) as Record<string, unknown> | null;
    const out: Record<string, unknown> = { ...extra };
    if (cur?.__NA) out.__NA = cur.__NA;
    if (cur?.__PRIVATE_NEXTJS_INTERNALS_TREE) out.__PRIVATE_NEXTJS_INTERNALS_TREE = cur.__PRIVATE_NEXTJS_INTERNALS_TREE;
    return out;
}
