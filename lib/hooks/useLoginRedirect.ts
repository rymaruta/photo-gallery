"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { loginWithNext } from "../routes";

/**
 * 未ログインの人を、戻り先を添えてログイン画面へ送る。
 *
 * **3か所が同じことを書いていた**——`useMemberGate`（投稿系4画面）・
 * `/user/profile`・`/user/settings`。**違うのは「送るかどうか」の条件だけ**
 * なので、条件は呼び出し側に残し、**送り方**をここへ集める:
 *
 *     useMemberGate   state === "anonymous" && !hasUnsavedWork
 *     /user/profile   !loading && !isAuthenticated && !hasUnsavedWork
 *     /user/settings  !loading && !isAuthenticated
 *
 * 条件が違うのには理由がある（設定はグループを見ない・打ちかけの扱いが
 * 違う）ので、**条件まで1つにまとめてはいけない**。まとめると
 * 「権限が付かなかった人が退会できない」に戻る。
 *
 * 🔴 **`push` ではなく `replace`。** push にすると、見られなかったページが
 * 履歴に残る:
 *
 *     [/] [/user/upload] [/login?next=/user/upload]
 *
 * ログイン後に `/user/upload` へ進み、そこで戻ると `/login` に着地する。
 * `/login` はログイン済みだと `next` へ送り返すので、**戻るを何度押しても
 * 2画面を往復するだけで前の画面に戻れない**。通せなかったページを履歴に
 * 残す意味は無い。
 */
export function useLoginRedirect(shouldSend: boolean): void {
    const router = useRouter();
    useEffect(() => {
        if (!shouldSend) return;
        router.replace(loginWithNext(window.location.pathname + window.location.search));
    }, [shouldSend, router]);
}
