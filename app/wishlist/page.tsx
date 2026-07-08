"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PaperAirplaneIcon, MapPinIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { useRouter } from "next/navigation";
import { useLocale } from "../i18n/context";
import { userFetch } from "../../lib/utils/api";
import { getLocalized } from "@/lib/data/photos";
import { ROUTES } from "../../lib/routes";
import type { GoListItem } from "../../lib/hooks/useGoTo";

// 行きたいリスト: 「行く」を押した場所の一覧。
// 実際にその場所で写真を投稿すると「行った！」が付き、元の投稿者に通知が届く。
export default function WishlistPage() {
    const { isAuthenticated, loading } = useAuth();
    const { locale } = useLocale();
    const router = useRouter();
    const [items, setItems] = useState<GoListItem[] | null>(null);

    useEffect(() => {
        if (!loading && !isAuthenticated) router.replace("/login");
    }, [loading, isAuthenticated, router]);

    useEffect(() => {
        if (!isAuthenticated) return;
        void (async () => {
            try {
                const res = await userFetch("/user/go");
                if (res.ok) {
                    const data = await res.json() as { items?: GoListItem[] };
                    setItems(Array.isArray(data.items) ? data.items : []);
                } else {
                    setItems([]);
                }
            } catch {
                setItems([]);
            }
        })();
    }, [isAuthenticated]);

    if (loading || !isAuthenticated || items === null) {
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    const fulfilled = items.filter((x) => x.fulfilled).length;

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
            <div className="mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold">
                    {locale === "en" ? "Travel List" : "行きたいリスト"}
                </h1>
                <p className="text-sm text-white/60 mt-1">
                    {locale === "en"
                        ? `${items.length} places saved${fulfilled > 0 ? ` · ${fulfilled} visited` : ""}`
                        : `${items.length} 件${fulfilled > 0 ? ` ・ ${fulfilled} 件 行った！` : ""}`}
                </p>
            </div>

            {items.length === 0 ? (
                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 flex flex-col items-center justify-center gap-3 text-center">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                        <PaperAirplaneIcon className="w-8 h-8 text-white/30 -rotate-45" />
                    </div>
                    <p className="text-white/70 text-sm">
                        {locale === "en" ? "No places saved yet." : "行きたい場所はまだありません。"}
                    </p>
                    <p className="text-white/40 text-xs max-w-xs">
                        {locale === "en"
                            ? "Tap 行く on a photo to save its place. Post a photo there later and the photographer gets notified."
                            : "写真の「行く」を押すとここに保存されます。実際にその場所で投稿すると、撮影者に「旅立たせました」通知が届きます。"}
                    </p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {items.map((item) => {
                        const title = getLocalized(item.title as never, locale as "ja" | "en") || (typeof item.title === "string" ? item.title : "");
                        return (
                            <li key={item.photoId}>
                                <Link
                                    href={ROUTES.PHOTO(item.photoId)}
                                    className="flex items-center gap-3 rounded-2xl bg-white/5 ring-1 ring-white/10 hover:ring-white/20 transition p-2.5"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={item.src} alt="" loading="lazy" className="w-16 h-16 rounded-xl object-cover bg-white/10 flex-shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-white truncate">{title || (locale === "en" ? "Photo" : "写真")}</p>
                                        {item.location && (
                                            <p className="text-xs text-white/50 truncate flex items-center gap-1 mt-0.5">
                                                <MapPinIcon className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                                                {item.location}
                                            </p>
                                        )}
                                    </div>
                                    {item.fulfilled ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/30 px-2.5 py-1 text-[11px] text-emerald-300 flex-shrink-0">
                                            <CheckCircleIcon className="w-3.5 h-3.5" />
                                            {locale === "en" ? "Visited!" : "行った！"}
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 ring-1 ring-white/10 px-2.5 py-1 text-[11px] text-white/50 flex-shrink-0">
                                            <PaperAirplaneIcon className="w-3 h-3 -rotate-45" />
                                            {locale === "en" ? "Someday" : "いつか"}
                                        </span>
                                    )}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </main>
    );
}
