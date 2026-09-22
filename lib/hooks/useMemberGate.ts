"use client";

import { useAuth } from "../../app/auth/context";
import { useLoginRedirect } from "./useLoginRedirect";

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

    const state: MemberGate = loading
        ? "loading"
        : !isAuthenticated
            ? "anonymous"
            : (!isAdminUser && !isGeneralUser)
                ? "no-group"
                : "ok";

    // 送るのは未ログインのときだけ。ここに no-group を含めると往復に戻る。
    // **打ちかけがあるときは送らない**（上のコメントを見よ）。
    // 送り方（`replace` と戻り先）は `useLoginRedirect` に集めた
    // ——`/user/profile` と `/user/settings` が同じことを書いていた
    useLoginRedirect(state === "anonymous" && !hasUnsavedWork);

    return state;
}
