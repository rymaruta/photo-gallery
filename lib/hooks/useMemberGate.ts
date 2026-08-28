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

export function useMemberGate(): MemberGate {
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
        // 送るのは未ログインのときだけ。ここに no-group を含めると往復に戻る
        if (state === "anonymous") {
            router.push(loginWithNext(window.location.pathname + window.location.search));
        }
    }, [state, router]);

    return state;
}
