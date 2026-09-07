"use client";

// 写真ページのコメント欄。公開閲覧、認証ユーザーが投稿でき、
// 投稿者本人または写真オーナーが削除できる。

import React, { useState } from "react";
import Link from "next/link";
import { ChatBubbleOvalLeftIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useComments } from "../../lib/hooks/useComments";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { ROUTES } from "../../lib/routes";
import UserAvatar from "./UserAvatar";
import { loginWithNext } from "../../lib/routes";

type Props = {
    photoId: string;
    photoOwnerId?: string;
    locale: "ja" | "en";
    initialCount?: number;
};

function timeAgo(iso: string, locale: "ja" | "en"): string {
    const t = Date.parse(iso);
    if (isNaN(t)) return "";
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return locale === "en" ? "today" : "今日";
    if (days === 1) return locale === "en" ? "yesterday" : "昨日";
    return locale === "en" ? `${days}d ago` : `${days}日前`;
}

export default function CommentSection({ photoId, photoOwnerId, locale, initialCount = 0 }: Props) {
    // ログイン後にこの写真へ戻す（サイト内パスだけを通す safeNextPath 経由）。
    // 戻り先が無いと、コメントしようとしていた写真を見失う。
    const loginHref = typeof window === "undefined"
        ? ROUTES.LOGIN
        : loginWithNext(window.location.pathname + window.location.search);
    // authLoading = ログイン状態がまだ分からない期間。ここを見ないと、
    // ログイン済みの人にも一瞬「ログインするとコメントできます」が出て、
    // その間にリンクを押すとログインページ経由で別の場所へ飛ばされる。
    const { isAuthenticated, userId, loading: authLoading } = useAuth();
    const { showToast } = useToast();
    const { items, count, loading, loadError, reload, pending, add, remove } = useComments(photoId, isAuthenticated, initialCount);
    const [text, setText] = useState("");

    const submit = async () => {
        const r = await add(text);
        if (r.status === "ok") { setText(""); }
        else if (r.status === "auth-required") showToast(locale === "en" ? "Log in to comment" : "コメントするにはログインしてください", "info");
        // 断られた理由はサーバーが日本語で返している
        // （「同じ写真へのコメントは10件までです」など）。
        // 一律「投稿に失敗しました」だと障害だと思って送り直され、
        // そのたびに写真と200件のコメント文書を読み直すことになる。
        //
        // 理由は `add` の**戻り値**から取る。フックの state から読むと、
        // この関数が作られた描画時点の値——つまり1回前の理由——になり、
        // 初回は必ず既定文、2回目に1回目の文言、とずれる。
        else if (r.status === "error") {
            showToast(r.message ?? (locale === "en" ? "Failed to post" : "投稿に失敗しました"), "error");
        }
    };

    return (
        <section className="pt-5 border-t border-white/10">
            <div className="flex items-center gap-1.5 mb-3">
                <ChatBubbleOvalLeftIcon className="w-4 h-4 text-white/50" />
                <h2 className="text-sm font-semibold text-white/70">
                    {locale === "en" ? "Comments" : "コメント"}
                    {count > 0 && <span className="ml-1.5 text-white/50 tabular-nums">{count}</span>}
                </h2>
            </div>

            {/* 入力欄 */}
            {isAuthenticated ? (
                <div className="flex items-start gap-2 mb-4">
                    {/* **Ctrl/Cmd+Enter に IME のガードは付けない。**
                        変換確定に使われるのは Enter 単体で、修飾キー付きは
                        IME が消費しない。それでも `isComposing` は
                        「そのとき変換が生きているか」だけを見るので、
                        変換の要らない語（「ありがとう」）を打ち終えた直後は
                        true のまま——ガードを付けると**送信が黙って死ぬ**。
                        `onChange` は変換中も発火するので `text` は画面と
                        一致しており、押した時点で見えている文字を送るのが正しい。
                        （一度ガードを付けて、レビューで実測されて外した） */}
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
                        placeholder={locale === "en" ? "Add a comment…" : "コメントを追加…"}
                        rows={2}
                        maxLength={500}
                        className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 resize-none"
                        style={{ fontSize: "16px" }}
                    />
                    <button
                        onClick={() => void submit()}
                        disabled={pending || !text.trim()}
                        className="flex-shrink-0 px-4 py-2 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {pending
                            ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            : (locale === "en" ? "Post" : "送信")}
                    </button>
                </div>
            ) : authLoading ? (
                // 判定中は入力欄の高さだけ確保する。ここで「ログインしてください」を
                // 出すと、ログイン済みの人にも一瞬表示されて誤操作を誘う。
                <div className="mb-4 h-[68px]" aria-hidden={true} />
            ) : (
                <p className="mb-4 text-xs text-white/50">
                    {/* 戻り先を添える。無いとログイン後に自分のプロフィールへ
                        飛ばされ、コメントしようとしていた写真を見失う */}
                    <Link href={loginHref} className="text-white/70 underline hover:text-white">
                        {locale === "en" ? "Log in" : "ログイン"}
                    </Link>
                    {locale === "en" ? " to join the conversation." : " するとコメントできます。"}
                </p>
            )}

            {/* 一覧 */}
            {loading ? (
                <div className="flex justify-center py-6"><div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" /></div>
            ) : loadError ? (
                // 取得の失敗を「0件」と混ぜない。付いているコメントが
                // 消えたように見える（admin 一覧・下書き一覧と同じ扱い）
                <p className="text-xs text-white/50 py-2">
                    {locale === "en" ? "Couldn't load comments. " : "コメントを読み込めませんでした。"}
                    <button onClick={reload} className="underline text-white/70 hover:text-white">
                        {locale === "en" ? "Retry" : "再読み込み"}
                    </button>
                </p>
            ) : items.length === 0 ? (
                <p className="text-xs text-white/50 py-2">
                    {locale === "en" ? "No comments yet. Be the first!" : "まだコメントがありません。最初のひとことを。"}
                </p>
            ) : (
                <ul className="space-y-3.5">
                    {items.map((c) => {
                        const canDelete = isAuthenticated && (c.uid === userId || (photoOwnerId && photoOwnerId === userId));
                        return (
                            <li key={c.id} className="flex items-start gap-2.5">
                                {/* 退会した人のプロフィールはもう無い（墓石になり、
                                    公開APIは空を返す）。リンクを出すと「開いても
                                    何も無いページ」へ誘うので、名前とアイコンだけ出す。 */}
                                {c.deleted ? (
                                    <span className="flex-shrink-0 mt-0.5">
                                        <UserAvatar userId="" className="w-7 h-7" iconClassName="w-4 h-4" />
                                    </span>
                                ) : (
                                    <Link href={ROUTES.USER_PROFILE(c.uid)} className="flex-shrink-0 mt-0.5">
                                        <UserAvatar userId={c.uid} className="w-7 h-7" iconClassName="w-4 h-4" />
                                    </Link>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        {c.deleted ? (
                                            <span className="text-[13px] font-semibold text-white/50 truncate">
                                                {c.name}
                                            </span>
                                        ) : (
                                            <Link href={ROUTES.USER_PROFILE(c.uid)} className="text-[13px] font-semibold text-white/85 hover:underline truncate">
                                                {c.name}
                                            </Link>
                                        )}
                                        <span className="text-[11px] text-white/50 flex-shrink-0">{timeAgo(c.t, locale)}</span>
                                        {canDelete && (
                                            <button
                                                onClick={() => void remove(c.id).then((ok) => {
                                                    // 失敗すると楽観削除がロールバックし、
                                                    // コメントが一瞬消えて黙って戻る。投稿は
                                                    // 理由を出すのに削除だけ無言だった（SW-b3）
                                                    if (!ok) showToast(locale === "en"
                                                        ? "Couldn't delete the comment. Please try again."
                                                        : "コメントを削除できませんでした。もう一度お試しください", "error");
                                                })}
                                                aria-label={locale === "en" ? "Delete comment" : "コメントを削除"}
                                                className="ml-auto flex-shrink-0 p-1 text-white/40 hover:text-red-400 transition"
                                                style={{ touchAction: "manipulation" }}
                                            >
                                                <TrashIcon className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-sm text-white/80 whitespace-pre-wrap break-words leading-snug mt-0.5">{c.text}</p>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
