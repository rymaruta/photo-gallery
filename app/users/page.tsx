"use client";

import React, { useEffect, useState, useMemo, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeftIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import { useLocale } from "../i18n/context";
import type { Photo } from "../data/photos";
import { getLocalized } from "../data/photos";
import { log } from "../../lib/utils/log";

function PhotoCard({ photo, locale }: { photo: Photo; locale: string }) {
    const [imageError, setImageError] = useState(false);
    const title = getLocalized(photo.title, locale as "ja" | "en") || (typeof photo.title === "string" ? photo.title : "");

    return (
        <a
            href={`/photo/${photo.id}`}
            className="block relative overflow-hidden bg-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            style={{ paddingTop: "100%" }}
        >
            {!imageError ? (
                <Image
                    src={photo.src}
                    alt={title}
                    fill
                    className="object-cover"
                    sizes="(max-width:640px) 33vw, (max-width:1024px) 25vw, 20vw"
                    loading="lazy"
                    onError={() => setImageError(true)}
                />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                    <svg className="w-8 h-8 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </div>
            )}
            <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors" />
        </a>
    );
}

function UsersPageInner() {
    const { locale } = useLocale();
    const searchParams = useSearchParams();
    const userId = searchParams.get("id");

    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!userId) {
            setLoading(false);
            setError("no-id");
            return;
        }

        const controller = new AbortController();
        const load = async () => {
            try {
                const { publicFetch } = await import("../../lib/utils/api");
                const res = await publicFetch(`/photos?userId=${encodeURIComponent(userId)}`, {
                    signal: controller.signal,
                });
                if (res.ok) {
                    const data = await res.json() as unknown;
                    if (Array.isArray(data)) {
                        setPhotos(data as Photo[]);
                    } else {
                        setError("fetch-error");
                    }
                } else {
                    setError("fetch-error");
                }
            } catch (e) {
                if ((e as { name?: string }).name !== "AbortError") {
                    log.error("user photos fetch error:", e);
                    setError("fetch-error");
                }
            } finally {
                setLoading(false);
            }
        };
        void load();
        return () => controller.abort();
    }, [userId]);

    const displayName = useMemo(() => {
        if (photos.length === 0) return null;
        return photos.find(p => p.displayName)?.displayName ?? null;
    }, [photos]);

    if (!userId || error === "no-id") {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
                    <p className="text-white/60 text-sm">
                        {locale === "en" ? "No user ID specified." : "ユーザーIDが指定されていません。"}
                    </p>
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors text-sm"
                    >
                        <ArrowLeftIcon className="w-4 h-4" />
                        {locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}
                    </Link>
                </div>
            </main>
        );
    }

    if (loading) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            </main>
        );
    }

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
            <div className="mb-6">
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-6"
                    style={{ minHeight: "44px" }}
                >
                    <ArrowLeftIcon className="w-4 h-4" />
                    <span className="text-sm">{locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}</span>
                </Link>

                {/* プロフィールヘッダー */}
                <div className="flex items-center gap-4 py-6">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                        <UserCircleIcon className="w-10 h-10 sm:w-12 sm:h-12 text-white/40" />
                    </div>
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold">
                            {displayName ?? (locale === "en" ? "Anonymous" : "ユーザー")}
                        </h1>
                        <p className="text-sm text-white/50 mt-1">
                            {locale === "en"
                                ? `${photos.length} photo${photos.length !== 1 ? "s" : ""}`
                                : `${photos.length} 枚`}
                        </p>
                    </div>
                </div>

                <div className="border-t border-white/10" />
            </div>

            {photos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-white/50 gap-2">
                    <UserCircleIcon className="w-12 h-12" />
                    <p className="text-sm">
                        {locale === "en" ? "No photos yet." : "まだ写真がありません。"}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-0.5">
                    {photos.map(photo => (
                        <PhotoCard key={photo.id} photo={photo} locale={locale} />
                    ))}
                </div>
            )}
        </main>
    );
}

export default function UsersPage() {
    return (
        <Suspense fallback={
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            </main>
        }>
            <UsersPageInner />
        </Suspense>
    );
}
