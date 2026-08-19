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

    const { users, loading } = useUserSearch(query);

    // 開いたらすぐ入力できる
    useEffect(() => { inputRef.current?.focus(); }, []);

    const onChange = useCallback((v: string) => {
        setInput(v);
        if (!composingRef.current) setQuery(v);
    }, []);

    const showEmpty = isSearchableQuery(input.trim().replace(/^@+/, "")) && !loading && users.length === 0;

    return (
        <main className="min-h-screen bg-black text-white max-w-2xl mx-auto w-full px-4 pb-16">
            <div className="flex items-center gap-2 py-3">
                <button
                    onClick={() => router.back()}
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
                <p className="text-sm text-white/40 text-center py-10 leading-relaxed">
                    {isJa
                        ? "名前か @ユーザー名 で探せます。\n見つけたらその場でフォローできます。"
                        : "Search by name or @username.\nYou can follow right from here."}
                </p>
            )}

            {showEmpty && (
                <p className="text-sm text-white/40 text-center py-10">
                    {isJa ? "見つかりませんでした" : "No one found"}
                </p>
            )}

            <ul className="flex flex-col divide-y divide-white/5">
                {users.map((u) => (
                    <li key={u.userId} className="flex items-center gap-3 py-3">
                        <Link
                            href={ROUTES.USER_PROFILE(u.userId)}
                            className="flex items-center gap-3 min-w-0 flex-1 group"
                            style={{ touchAction: "manipulation" }}
                        >
                            <div
                                className="rounded-full p-[2px] flex-shrink-0"
                                style={{ background: u.themeColor || "rgba(255,255,255,0.12)" }}
                            >
                                <div className="rounded-full p-[2px] bg-black">
                                    <UserAvatar userId={u.userId} className="w-12 h-12" iconClassName="w-7 h-7" />
                                </div>
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-white truncate group-hover:underline">
                                    {u.displayName || (u.username ? `@${u.username}` : (isJa ? "ユーザー" : "User"))}
                                </p>
                                {u.username && u.displayName && (
                                    <p className="text-xs text-white/45 truncate">@{u.username}</p>
                                )}
                                {u.bio && (
                                    <p className="text-xs text-white/35 truncate">{u.bio}</p>
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
