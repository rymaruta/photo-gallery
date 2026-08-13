"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { ArrowLeftIcon, PhotoIcon } from "@heroicons/react/24/outline";
import type { Photo } from "@/lib/data/photos";
import { getLocalized } from "@/lib/data/photos";
import { log } from "../../../lib/utils/log";
import { ROUTES } from "../../../lib/routes";

export default function DraftsPage() {
    const { isAuthenticated, isAdminUser, isGeneralUser, loading } = useAuth();
    const router = useRouter();
    const { locale } = useLocale();
    const isJa = locale === "ja";

    const [drafts, setDrafts] = useState<Photo[]>([]);
    const [loadingDrafts, setLoadingDrafts] = useState(true);

    useEffect(() => {
        if (!loading && (!isAuthenticated || (!isAdminUser && !isGeneralUser))) {
            router.push(ROUTES.LOGIN);
        }
    }, [isAuthenticated, isAdminUser, isGeneralUser, loading, router]);

    const load = useCallback(async () => {
        setLoadingDrafts(true);
        try {
            const { userFetch } = await import("../../../lib/utils/api");
            const res = await userFetch("/user/photos");
            if (res.ok) {
                const all = await res.json() as Photo[];
                setDrafts(Array.isArray(all) ? all.filter((p) => p.published === false) : []);
            } else {
                log.error("drafts fetch failed", { status: res.status });
            }
        } catch (e) {
            log.error("drafts load error:", e);
        } finally {
            setLoadingDrafts(false);
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated && (isAdminUser || isGeneralUser)) void load();
    }, [isAuthenticated, isAdminUser, isGeneralUser, load]);

    if (loading || (!isAuthenticated && loadingDrafts)) {
        return (
            <main className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-black text-white">
            <div className="max-w-3xl mx-auto px-4 py-8">
                <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-4">
                        <Link href={ROUTES.HOME} className="text-white/60 hover:text-white transition-colors">
                            <ArrowLeftIcon className="w-5 h-5" />
                        </Link>
                        <h1 className="text-xl font-semibold">
                            {isJa ? "下書き" : "Drafts"}
                            {drafts.length > 0 && <span className="ml-2 text-sm text-white/40">{drafts.length}</span>}
                        </h1>
                    </div>
                    <Link
                        href={ROUTES.UPLOAD}
                        className="px-3.5 py-2 text-sm bg-white/10 hover:bg-white/20 rounded-full ring-1 ring-white/15 transition-colors"
                        style={{ touchAction: "manipulation" }}
                    >
                        {isJa ? "写真を追加" : "Add photos"}
                    </Link>
                </div>

                <p className="text-sm text-white/50 mb-6">
                    {isJa
                        ? "撮った写真を下書きに保存しておき、あとでタイトル等を入れて公開できます。"
                        : "Keep photos as drafts, then add details and publish them later."}
                </p>

                {loadingDrafts ? (
                    <div className="py-16 flex justify-center">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    </div>
                ) : drafts.length === 0 ? (
                    <div className="py-16 text-center text-white/50">
                        <PhotoIcon className="w-12 h-12 mx-auto mb-3 text-white/20" />
                        <p className="text-sm mb-4">{isJa ? "下書きはありません" : "No drafts yet"}</p>
                        <Link
                            href={ROUTES.UPLOAD}
                            className="inline-block px-4 py-2.5 text-sm bg-white text-black font-semibold rounded-full hover:bg-white/90 transition-colors"
                            style={{ touchAction: "manipulation", minHeight: "44px" }}
                        >
                            {isJa ? "写真をアップロード" : "Upload photos"}
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                        {drafts.map((p) => {
                            const title = getLocalized(p.title, locale) || (typeof p.title === "string" ? p.title : "");
                            const dateText = p.exif?.dateTimeOriginal || p.date || "";
                            return (
                                <Link
                                    key={p.id}
                                    href={ROUTES.EDIT(p.id)}
                                    className="group block rounded-xl overflow-hidden bg-white/5 ring-1 ring-white/10 hover:ring-white/25 transition"
                                    style={{ touchAction: "manipulation" }}
                                >
                                    <div className="relative aspect-square bg-white/5" style={{ backgroundColor: p.dominantColor ?? undefined }}>
                                        {(p.thumbSrc || p.src) && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={p.thumbSrc || p.src}
                                                alt=""
                                                loading="lazy"
                                                className="absolute inset-0 w-full h-full object-cover"
                                            />
                                        )}
                                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white/90 ring-1 ring-white/15">
                                            {isJa ? "下書き" : "Draft"}
                                        </span>
                                    </div>
                                    <div className="p-2">
                                        <p className="text-xs text-white/80 truncate">
                                            {title || (isJa ? "無題" : "Untitled")}
                                        </p>
                                        {(p.location || dateText) && (
                                            <p className="text-[11px] text-white/40 truncate">
                                                {[p.location, dateText].filter(Boolean).join(" · ")}
                                            </p>
                                        )}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </main>
    );
}
