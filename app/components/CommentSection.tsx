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
    const { isAuthenticated, userId } = useAuth();
    const { showToast } = useToast();
    const { items, count, loading, pending, add, remove } = useComments(photoId, isAuthenticated, initialCount);
    const [text, setText] = useState("");

    const submit = async () => {
        const r = await add(text);
        if (r === "ok") { setText(""); }
        else if (r === "auth-required") showToast(locale === "en" ? "Log in to comment" : "コメントするにはログインしてください", "info");
        else if (r === "error") showToast(locale === "en" ? "Failed to post" : "投稿に失敗しました", "error");
    };

    return (
        <section className="pt-5 border-t border-white/10">
            <div className="flex items-center gap-1.5 mb-3">
                <ChatBubbleOvalLeftIcon className="w-4 h-4 text-white/50" />
                <h2 className="text-sm font-semibold text-white/70">
                    {locale === "en" ? "Comments" : "コメント"}
                    {count > 0 && <span className="ml-1.5 text-white/40 tabular-nums">{count}</span>}
                </h2>
            </div>

            {/* 入力欄 */}
            {isAuthenticated ? (
                <div className="flex items-start gap-2 mb-4">
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
            ) : (
                <p className="mb-4 text-xs text-white/40">
                    <Link href={ROUTES.LOGIN} className="text-white/70 underline hover:text-white">
                        {locale === "en" ? "Log in" : "ログイン"}
                    </Link>
                    {locale === "en" ? " to join the conversation." : " するとコメントできます。"}
                </p>
            )}

            {/* 一覧 */}
            {loading ? (
                <div className="flex justify-center py-6"><div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" /></div>
            ) : items.length === 0 ? (
                <p className="text-xs text-white/35 py-2">
                    {locale === "en" ? "No comments yet. Be the first!" : "まだコメントがありません。最初のひとことを。"}
                </p>
            ) : (
                <ul className="space-y-3.5">
                    {items.map((c) => {
                        const canDelete = isAuthenticated && (c.uid === userId || (photoOwnerId && photoOwnerId === userId));
                        return (
                            <li key={c.id} className="flex items-start gap-2.5">
                                <Link href={ROUTES.USER_PROFILE(c.uid)} className="flex-shrink-0 mt-0.5">
                                    <UserAvatar userId={c.uid} className="w-7 h-7" iconClassName="w-4 h-4" />
                                </Link>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <Link href={ROUTES.USER_PROFILE(c.uid)} className="text-[13px] font-semibold text-white/85 hover:underline truncate">
                                            {c.name}
                                        </Link>
                                        <span className="text-[11px] text-white/35 flex-shrink-0">{timeAgo(c.t, locale)}</span>
                                        {canDelete && (
                                            <button
                                                onClick={() => void remove(c.id)}
                                                aria-label={locale === "en" ? "Delete comment" : "コメントを削除"}
                                                className="ml-auto flex-shrink-0 p-1 text-white/30 hover:text-red-400 transition"
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
