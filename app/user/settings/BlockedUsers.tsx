"use client";

/**
 * ブロックした人の一覧と解除。
 *
 * **押せる場所が無かった。** `DELETE /users/{id}/block` と
 * `GET /user/blocks` はサーバー側に前からあるのに、呼ぶ画面が1つも
 * 無かった（grep で0件）。ストーリーの返信からブロックできるように
 * したぶん、**誤って押すと元に戻せない**状態を新しく作っていた
 * ——しかもブロックは相手とのフォローを両向きに切るので、実害がある。
 *
 * 置き場所はプロフィール設定。新しい画面は作らない
 * （CLAUDE.md「機能は足すより減らす方向」）。**1人も居なければ
 * 何も描かない**——普通の人には一生関係の無い節なので。
 */

import React, { useCallback, useEffect, useState } from "react";
import { userFetch, readApiError, sessionErrorMessage } from "../../../lib/utils/api";
import { usableUserRows, type UserRow } from "../../../lib/utils/userRows";

export default function BlockedUsers({ locale }: { locale: "ja" | "en" }) {
    const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
    const [users, setUsers] = useState<UserRow[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    /** 解除が効かなかった理由（押した場所の近くに1行出す） */
    const [actionError, setActionError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await userFetch("/user/blocks");
                if (!res.ok) throw new Error(String(res.status));
                const data = await res.json() as { users?: unknown; blockedIds?: unknown };
                if (cancelled) return;
                // **古い応答の形（ID だけ）でも出す。** API を先に出す運用なので
                // ふつうは起きないが、順序に依存させる理由が無い（2行で消せる）
                const raw = data.users ?? (Array.isArray(data.blockedIds)
                    ? (data.blockedIds as unknown[]).map((id) => ({ id })) : undefined);
                const list = usableUserRows(raw, "blocks");
                if (!list) { setState("failed"); return; }
                setUsers(list);
                setState("ready");
            } catch {
                if (!cancelled) setState("failed");
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const unblock = useCallback(async (id: string) => {
        if (busy) return;
        setBusy(id);
        setActionError(null);
        try {
            const res = await userFetch(`/users/${encodeURIComponent(id)}/block`, { method: "DELETE" });
            // **効いたときだけ画面から消す。** 失敗を成功に見せると
            // 「解除したのにまだ届かない」で二度目の落胆になる
            if (res.ok) { setUsers((prev) => prev.filter((u) => u.id !== id)); return; }
            // **失敗を無言にしない。** ボタンが「解除しています…」から
            // 戻って行が残るだけなので、効かなかったのか・まだなのか・
            // 押し方が悪いのかが分からなかった。**ここはブロック解除の
            // 唯一の口**で、`StoryViewer` と `UserProfileClient` が
            // 「解除はプロフィール設定から」と案内する到達先。
            // 同じファイルの取得失敗は文言で伝えているのに、ここだけ黙っていた
            setActionError(await readApiError(res, locale === "en"
                ? "Couldn't unblock. Please try again." : "解除できませんでした。もう一度お試しください"));
        } catch (e) {
            // 圏外とセッション切れを混ぜない（同じファイルの取得側と同じ形）
            setActionError(sessionErrorMessage(e) ?? (locale === "en"
                ? "Couldn't unblock. Please try again." : "解除できませんでした。もう一度お試しください"));
        } finally {
            setBusy(null);
        }
        // `locale` を入れる（文言を読むようになったので、古い値を掴まない）
    }, [busy, locale]);

    // **取得に失敗したら、そう言う。** 黙って消すと、ストーリーの返信欄が
    // 「解除はプロフィール設定からできます」と案内している先が
    // **何も無い行き止まり**になる（解除の口はここしかない）。
    // 黙っていた頃は `state` が出力を1度も変えず、「0人と言い切らない」を
    // 守っていたのは長さの判定だけだった＝この分岐は無検証だった。
    if (state === "failed") {
        return (
            <div className="mt-10 pt-6 border-t border-white/10">
                <p className="text-xs text-white/60">
                    {locale === "en"
                        ? "Couldn't load your blocked list. Reload the page to try again."
                        : "ブロックした人を読み込めませんでした。ページを開き直すともう一度試します。"}
                </p>
            </div>
        );
    }
    // 取得中は黙る（この節はふだん空。読み込み中の枠を置く方が邪魔）
    if (state !== "ready" || users.length === 0) return null;

    return (
        <div className="mt-10 pt-6 border-t border-white/10">
            <p className="text-[11px] tracking-widest uppercase text-white/60 mb-2">
                {locale === "en" ? "Blocked" : "ブロックした人"}
            </p>
            <p className="text-xs text-white/60 leading-relaxed mb-3">
                {locale === "en"
                    ? "They can't reply to your stories, comment on your photos, or follow you. Unblocking does not restore the follows that blocking removed."
                    : "ストーリーへの返信・写真へのコメント・フォローができなくなります。解除しても、ブロックのときに外れたフォローは戻りません。"}
            </p>
            {/* 解除が効かなかった理由。**一覧の上**に置く——押したボタンは
                行の中にあるが、行は消えないので近くに1行あれば足りる */}
            {actionError && (
                <p role="alert" className="text-sm text-white/85 mb-3">{actionError}</p>
            )}
            <ul className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 divide-y divide-white/5">
                {users.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        {/* **退会した人はここで出し分ける。** サーバーが返す
                            `name` は日本語固定なので、そのまま出すと
                            英語表示の人にも「退会したユーザー」が出る
                            （`FollowingSheet` は `deleted` を見て
                            "Deleted user" を出している＝同じ画面群で
                            扱いが割れていた）。解除は押せるままにする
                            ——押せないと外せなくなる */}
                        <span className={`text-sm truncate ${u.deleted ? "text-white/60" : "text-white/85"}`}>
                            {u.deleted
                                ? (locale === "en" ? "Deleted user" : "退会したユーザー")
                                : (u.name ?? (locale === "en" ? "User" : "旅人"))}
                        </span>
                        <button
                            type="button"
                            onClick={() => void unblock(u.id)}
                            disabled={busy === u.id}
                            className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs text-white/85 ring-1 ring-inset ring-white/20 hover:bg-white/10 disabled:opacity-50 active:scale-95 transition"
                            style={{ touchAction: "manipulation" }}
                        >
                            {busy === u.id
                                ? (locale === "en" ? "Unblocking…" : "解除しています…")
                                : (locale === "en" ? "Unblock" : "解除")}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
