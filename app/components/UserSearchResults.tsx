"use client";

import React from "react";
import Link from "next/link";
import UserAvatar from "./UserAvatar";
import { useUserSearch } from "../../lib/hooks/useUserSearch";

type Props = {
    /** 検索語（写真の検索と同じ入力欄の値） */
    query: string;
    locale?: string;
};

/**
 * 検索語に一致するユーザーを写真の上に出す。
 * 一致が無いときは何も描画しない（写真が主役なので、空の枠で場所を取らない）。
 */
export default function UserSearchResults({ query, locale = "ja" }: Props) {
    const { users } = useUserSearch(query);
    if (users.length === 0) return null;

    return (
        <section className="mb-5" aria-label={locale === "en" ? "People" : "ユーザー"}>
            <h2 className="text-xs text-white/40 mb-2">
                {locale === "en" ? "People" : "ユーザー"}
            </h2>
            <ul className="flex flex-col gap-1">
                {users.map((u) => (
                    <li key={u.userId}>
                        <Link
                            href={`/users/${encodeURIComponent(u.userId)}`}
                            className="flex items-center gap-3 p-2 -mx-2 rounded-xl hover:bg-white/5 active:bg-white/10 transition"
                            style={{ touchAction: "manipulation" }}
                        >
                            <div
                                className="rounded-full p-[2px] flex-shrink-0"
                                style={{ background: u.themeColor || "rgba(255,255,255,0.12)" }}
                            >
                                <div className="rounded-full p-[2px] bg-black">
                                    <UserAvatar userId={u.userId} className="w-10 h-10" iconClassName="w-6 h-6" />
                                </div>
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm text-white truncate">
                                    {u.displayName || (u.username ? `@${u.username}` : (locale === "en" ? "User" : "ユーザー"))}
                                </p>
                                {u.username && u.displayName && (
                                    <p className="text-xs text-white/45 truncate">@{u.username}</p>
                                )}
                                {u.bio && !u.username && (
                                    <p className="text-xs text-white/45 truncate">{u.bio}</p>
                                )}
                            </div>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}
