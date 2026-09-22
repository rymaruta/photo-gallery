"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import UserAvatar from "../../components/UserAvatar";
import { FollowAction } from "../../components/FollowButton";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useUserSearch, isSearchableQuery } from "../../../lib/hooks/useUserSearch";
import { ROUTES } from "../../../lib/routes";

/**
 * ユーザーを探すページ。
 *
 * 想定している使い方は「知り合いが登録したからフォローしておく」。
 * そのため名前を入れたらすぐ結果が出て、プロフィールを開かずに
 * その場でフォローまで済ませられるようにしている。
 */
export default function UserSearchPage() {
    const { locale } = useLocale();
    const { isAuthenticated, userId } = useAuth();
    const router = useRouter();
    const isJa = locale !== "en";

    const [input, setInput] = useState("");
    // 日本語の変換中は検索しない（変換候補の途中で結果が入れ替わらないように）
    const composingRef = useRef(false);
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const { users, loading, failed } = useUserSearch(query);

    // 開いたらすぐ入力できる
    useEffect(() => { inputRef.current?.focus(); }, []);

    const onChange = useCallback((v: string) => {
        setInput(v);
        if (!composingRef.current) setQuery(v);
    }, []);

    // 「見つかりませんでした」は、実際に検索した語（query）を基準に出す。
    // input を見ていた頃は、日本語入力の変換中（composing）は query が
    // 空のまま＝検索が走っていないのに、1文字目から
    // 「見つかりませんでした」が出続けていた。
    // **失敗と 0件を分ける。** `loading` とは分けてあったが、エラーは
    // 0件と同じ扱いで「見つかりませんでした」が出ていた——API が落ちて
    // いるだけなのに「その人は登録していない」と読める。
    const searched = isSearchableQuery(query.trim().replace(/^@+/, "")) && !loading;
    const showEmpty = searched && !failed && users.length === 0;
    const showFailed = searched && failed && users.length === 0;

    return (
        <main className="min-h-screen bg-bg text-white max-w-2xl mx-auto w-full px-4 pb-16">
            <div className="flex items-center gap-2 py-3">
                <button
                    onClick={() => {
                        // **戻る先が無ければトップへ。** 共有リンクや
                        // ブックマークでこの画面を直接開いた場合、`back()` は
                        // **サイトの外**（前に見ていた別のサイト）へ出てしまう。
                        // `history.length === 1` は「このタブで最初の1画面」。
                        // クライアント遷移で来ていれば 2 以上になる。
                        if (typeof window !== "undefined" && window.history.length <= 1) router.push(ROUTES.HOME);
                        else router.back();
                    }}
                    aria-label={isJa ? "戻る" : "Back"}
                    className="p-2 -ml-2 text-white/70 hover:text-white"
                    style={{ touchAction: "manipulation" }}
                >
                    <ArrowLeftIcon className="w-5 h-5" />
                </button>
                <h1 className="text-base font-semibold">{isJa ? "ユーザーを探す" : "Find people"}</h1>
            </div>

            <div className="relative mb-5">
                <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35 pointer-events-none" />
                <input
                    ref={inputRef}
                    type="search"
                    value={input}
                    onChange={(e) => onChange(e.target.value)}
                    onCompositionStart={() => { composingRef.current = true; }}
                    onCompositionEnd={(e) => { composingRef.current = false; onChange(e.currentTarget.value); }}
                    placeholder={isJa ? "名前・@ユーザー名" : "Name or @username"}
                    aria-label={isJa ? "ユーザーを検索" : "Search people"}
                    className="w-full rounded-full bg-white/[0.07] text-white placeholder:text-white/35 border border-transparent focus:border-white/20 focus:bg-white/10 outline-none transition"
                    style={{ padding: "12px 40px 12px 40px", fontSize: "16px" }}
                />
                {input && (
                    <button
                        onClick={() => { setInput(""); setQuery(""); inputRef.current?.focus(); }}
                        aria-label={isJa ? "検索をクリア" : "Clear search"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-white/10 transition"
                        style={{ touchAction: "manipulation" }}
                    >
                        <XMarkIcon className="w-4 h-4 text-white/60" />
                    </button>
                )}
            </div>

            {!input && (
                <p className="text-sm text-white/50 text-center py-10 leading-relaxed">
                    {isJa
                        ? "名前か @ユーザー名 で探せます。\n見つけたらその場でフォローできます。"
                        : "Search by name or @username.\nYou can follow right from here."}
                </p>
            )}

            {/* **押した結果を読み上げる**（WCAG 4.1.3・曲検索と同じ判断）。
                どちらも「検索」を押したあとにだけ出る（`searched` が要る）ので、
                開いた瞬間に喋り出すことはない。見た目は変わらない */}
            {showEmpty && (
                <p className="text-sm text-white/50 text-center py-10" role="status">
                    {isJa ? "見つかりませんでした" : "No one found"}
                </p>
            )}

            {showFailed && (
                <p className="text-sm text-amber-200/80 text-center py-10" role="alert">
                    {isJa ? "検索できませんでした。少し待ってからもう一度お試しください。" : "Couldn't search right now. Please try again in a moment."}
                </p>
            )}

            <ul className="flex flex-col divide-y divide-white/5">
                {users.map((u) => (
                    <li key={u.userId} className="flex items-center gap-3 py-3">
                        <Link
                            href={ROUTES.USER_PROFILE(u.userId)}
                            prefetch={false}
                            className="flex items-center gap-3 min-w-0 flex-1 group"
                            style={{ touchAction: "manipulation" }}
                        >
                            <div
                                className="rounded-full p-[2px] flex-shrink-0"
                                style={{ background: u.themeColor || "rgba(255,255,255,0.12)" }}
                            >
                                <div className="rounded-full p-[2px] bg-bg">
                                    <UserAvatar userId={u.userId} className="w-12 h-12" iconClassName="w-7 h-7" />
                                </div>
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-white truncate group-hover:underline">
                                    {u.displayName || (u.username ? `@${u.username}` : (isJa ? "ユーザー" : "User"))}
                                </p>
                                {u.username && u.displayName && (
                                    <p className="text-xs text-white/50 truncate">@{u.username}</p>
                                )}
                                {u.bio && (
                                    <p className="text-xs text-white/50 truncate">{u.bio}</p>
                                )}
                            </div>
                        </Link>
                        {/* プロフィールを開かずにここでフォローできる */}
                        <div className="flex-shrink-0 w-28">
                            <FollowAction
                                targetUserId={u.userId}
                                isOwner={!!userId && userId === u.userId}
                                isAuthenticated={isAuthenticated}
                                locale={locale}
                            />
                        </div>
                    </li>
                ))}
            </ul>
        </main>
    );
}
