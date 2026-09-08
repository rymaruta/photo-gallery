"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../app/auth/context";
import { loginWithNext } from "../routes";

/**
 * 投稿系のページ（アップロード・編集・下書き）の入口。
 *
 * **ログイン済みなのに権限が無い人を、ログイン画面へ送り返してはいけない。**
 * 3つのページが同じ判定を各自で書いていて、どれも
 * 「`isAuthenticated` かつグループ無し」→ `loginWithNext` へ push、
 * ところが `/login` は `isAuthenticated` を見て `next` へ push し返すので、
 * **無限に往復して何も表示されなかった**（本人には直す手段が無い）。
 *
 * これが起きるのは、登録直後の `AdminAddUserToGroup` が落ちたとき。
 * トリガーは失敗しても登録を成功させる作りで、プロフィール行の方には
 * 自己修復（`createProfileIfMissing`）があるが、**グループを入れ直す経路は
 * アプリのどこにも無い**。再ログインでも直らない（Cognito 側に無いため）。
 *
 * なので分けて返す:
 *   - `loading`   … まだ分からない（スピナーのまま）
 *   - `anonymous` … 未ログイン。ログインへ送る（従来どおり）
 *   - `no-group`  … ログイン済みだが権限が無い。**送り返さず、事情を出す**
 *   - `ok`        … 通す
 */
export type MemberGate = "loading" | "anonymous" | "no-group" | "ok";

/**
 * @param hasUnsavedWork 打ちかけの内容があるか。**あるときは送り返さない**
 *   ——`router.replace` は画面を作り直すので、未保存の確認（`/user/edit` の
 *   「破棄して戻る」）を通らずに文章ごと消える。ログインが切れた側は
 *   どのみち保存できないが、**書いたものを消してよい理由にはならない**。
 *   呼び出し側は「保存できない」ことを画面で伝えること。
 */
export function useMemberGate(hasUnsavedWork = false): MemberGate {
    const { isAuthenticated, isAdminUser, isGeneralUser, loading } = useAuth();
    const router = useRouter();

    const state: MemberGate = loading
        ? "loading"
        : !isAuthenticated
            ? "anonymous"
            : (!isAdminUser && !isGeneralUser)
                ? "no-group"
                : "ok";

    useEffect(() => {
        // 送るのは未ログインのときだけ。ここに no-group を含めると往復に戻る。
        // **打ちかけがあるときは送らない**（上のコメントを見よ）
        if (state === "anonymous" && !hasUnsavedWork) {
            // **push ではなく replace。** push にすると、見られなかった
            // ページが履歴に残る:
            //   [/] [/user/upload] [/login?next=/user/upload]
            // ログイン後に /user/upload へ進み、そこで戻ると /login に着地する。
            // /login はログイン済みだと next へ送り返すので、**戻るを何度
            // 押しても2画面を往復するだけで前の画面に戻れない**。
            // 通せなかったページは履歴に残す意味が無い。
            router.replace(loginWithNext(window.location.pathname + window.location.search));
        }
    }, [state, router, hasUnsavedWork]);

    return state;
}
