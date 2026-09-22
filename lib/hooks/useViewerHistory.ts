"use client";

import { useEffect, useRef } from "react";
import { withNextHistoryState } from "../utils/historyState";

/** 自分が積んだ1件であることの印（`useGallery` の `photoModal` と別名にする） */
const MARK = "viewerOpen";

/**
 * **その場で開くビューアを、端末の「戻る」で閉じられるようにする。**
 *
 * 開いた瞬間に履歴を1件積み、閉じるときにその1件を戻して消す。
 * 積まないと、**戻るでページごと離脱する**——撮影スポット詳細
 * （`/location/*`）は検索の着地点なので、そこで押すと**サイトの外**へ出る
 * （2026-09-22 のレビューで発覚。その場で拡大する形にした回の取りこぼし）。
 *
 * ## `useGallery` の履歴処理と分けた理由
 *
 * あちらは**絞り込みの URL 同期（`?category=` `?q=` `?sort=` `?tags=`
 * `?scope=`）と `?photo=` の共有リンク**まで一緒に面倒を見ていて、
 * 「共有リンクで開いたときは積まない」という枝まで持っている。
 * ビューアだけを開く画面にはその材料が無く、持ち込むと**使わない枝**が
 * 増える。**共通にしたのは `withNextHistoryState`**——`__NA` を持ち越さないと
 * 戻るたびにページが再読み込みされる、という教訓の本体はそこにある。
 *
 * ## 積むのは「開いた1回」だけ
 *
 * 前後に送るたびに積むと、閉じるのに**送った回数ぶん**戻るを押すことになる。
 *
 * ## 戻るで閉じたときは、こちらから `back()` しない
 *
 * ブラウザが既に1件戻している。二重に戻すと、その前のページまで飛ぶ。
 *
 * ## 開いたまま画面を離れたら、何もしない
 *
 * ビューアの中のリンク（写真ページ・地図）を押すと、この部品は
 * **後始末を待たずに消える**。そこで `back()` を撃つと、**押したリンクの
 * 行き先から引き返す**ことになる。だから後始末（cleanup）では戻さない
 * ——残る1件は、戻ったときに「ビューアの閉じた同じページ」を指すだけ。
 */
export function useViewerHistory(open: boolean, onClose: () => void): void {
    const pushedRef = useRef(false);
    // 依存に入れると、呼ぶ側が毎回新しい関数を渡したときに購読を張り直す
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; }, [onClose]);

    useEffect(() => {
        if (!open || typeof window === "undefined") return;
        const onPop = () => {
            // 既に1件戻っている。こちらから `back()` しない（上の説明）
            pushedRef.current = false;
            closeRef.current();
        };
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, [open]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (open) {
            if (pushedRef.current) return;  // 送っただけでは積まない
            pushedRef.current = true;
            // **URL は変えない。** この画面の写真は `/photo/<id>` を持っていて、
            // 深いリンクはそちらが担っている（同じことを2通りにしない）
            window.history.pushState(withNextHistoryState({ [MARK]: true }), "", window.location.href);
            return;
        }
        if (!pushedRef.current) return;
        pushedRef.current = false;
        // 自分の1件がまだ現在地のときだけ戻す
        if ((window.history.state as Record<string, unknown> | null)?.[MARK]) window.history.back();
    }, [open]);
}
