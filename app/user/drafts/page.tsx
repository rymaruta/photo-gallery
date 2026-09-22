"use client";

import { usablePhotoRows } from "../../../lib/utils/apiRows";
import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { ArrowLeftIcon, PhotoIcon } from "@heroicons/react/24/outline";
import type { Photo } from "@/lib/data/photos";
import { getLocalized } from "@/lib/data/photos";
import { log } from "../../../lib/utils/log";
import { ROUTES } from "../../../lib/routes";
import { formatStoredDateTime } from "@/lib/utils/photoDate";
import { useMemberGate } from "../../../lib/hooks/useMemberGate";
import MemberOnlyNotice from "../../components/MemberOnlyNotice";
import { publicImageUrl } from "@/lib/utils/seo";

export default function DraftsPage() {
    const { isAuthenticated, isAdminUser, isGeneralUser, loading } = useAuth();
    const { locale } = useLocale();
    const isJa = locale === "ja";

    const [drafts, setDrafts] = useState<Photo[]>([]);
    const [loadingDrafts, setLoadingDrafts] = useState(true);
    // 取得に失敗したかどうか。失敗を「下書き0件」と同じ見た目にすると、
    // 保存した下書きが消えたように見える（実際はサーバーに残っている）。
    const [loadError, setLoadError] = useState(false);

    const gate = useMemberGate();

    const load = useCallback(async () => {
        setLoadingDrafts(true);
        // 取れなかったことを画面にも残す。
        // 以前は失敗してもログを出すだけで drafts が [] のままだったので、
        // 「下書きはありません」＋アップロードの誘導が出た。
        // 保存した下書きが消えたように見えるが、実際はサーバーに残っている。
        setLoadError(false);
        try {
            const { userFetch } = await import("../../../lib/utils/api");
            const res = await userFetch("/user/photos");
            if (res.ok) {
                // 読めない行は落とす（1件の巻き添えで下書きが全部消えないように）
                const all = usablePhotoRows<Photo>(await res.json(), "GET /user/photos");
                if (!all) {
                    // **配列でない応答を「0件」に混ぜない。** このファイルの
                    // 上のコメントが「失敗を『下書き0件』と同じ見た目にすると、
                    // 保存した下書きが消えたように見える」と書いているとおり。
                    // 同じ周に `user/edit` で同じ判断をしながら、ここを
                    // 見落としていた
                    log.error("drafts response is not an array");
                    setLoadError(true);
                    return;
                }
                setDrafts(all.filter((p) => p.published === false));
            } else {
                log.error("drafts fetch failed", { status: res.status });
                setLoadError(true);
            }
        } catch (e) {
            log.error("drafts load error:", e);
            setLoadError(true);
        } finally {
            setLoadingDrafts(false);
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated && (isAdminUser || isGeneralUser)) void load();
    }, [isAuthenticated, isAdminUser, isGeneralUser, load]);

    // 権限が無い人はログイン画面へ送り返さない（/login が押し返して往復する）
    if (gate === "no-group") return <MemberOnlyNotice locale={locale} />;
    if (loading || (!isAuthenticated && loadingDrafts)) {
        return (
            <main className="min-h-screen bg-bg flex items-center justify-center">
                {/* **事前描画で焼かれるのはこの枝**（認証を確かめる前）。
                    JS が走る前に見えるのはここなので見出しを持たせる */}
                <h1 className="sr-only">下書き</h1>
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-bg text-white">
            <div className="max-w-3xl mx-auto px-4 py-8">
                <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-4">
                        <Link href={ROUTES.HOME} className="text-white/60 hover:text-white transition-colors">
                            <ArrowLeftIcon className="w-5 h-5" />
                        </Link>
                        <h1 className="text-xl font-semibold">
                            {isJa ? "下書き" : "Drafts"}
                            {drafts.length > 0 && <span className="ml-2 text-sm text-white/50">{drafts.length}</span>}
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
                ) : loadError ? (
                    <div className="py-16 text-center text-white/50">
                        <p className="text-sm mb-1">{isJa ? "下書きを読み込めませんでした" : "Could not load your drafts"}</p>
                        <p className="text-xs mb-4">
                            {isJa ? "消えたわけではありません。通信を確かめてもう一度お試しください。"
                                : "Nothing was lost. Check your connection and try again."}
                        </p>
                        <button
                            onClick={() => void load()}
                            className="inline-block px-4 py-2.5 text-sm bg-accent-fill text-white font-semibold rounded-full hover:brightness-110 transition-colors"
                            style={{ touchAction: "manipulation", minHeight: "44px" }}
                        >
                            {isJa ? "再試行" : "Retry"}
                        </button>
                    </div>
                ) : drafts.length === 0 ? (
                    <div className="py-16 text-center text-white/50">
                        <PhotoIcon className="w-12 h-12 mx-auto mb-3 text-white/20" />
                        <p className="text-sm mb-4">{isJa ? "下書きはありません" : "No drafts yet"}</p>
                        <Link
                            href={ROUTES.UPLOAD}
                            className="inline-block px-4 py-2.5 text-sm bg-accent-fill text-white font-semibold rounded-full hover:brightness-110 transition-colors"
                            style={{ touchAction: "manipulation", minHeight: "44px" }}
                        >
                            {isJa ? "写真をアップロード" : "Upload photos"}
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                        {drafts.map((p) => {
                            const title = getLocalized(p.title, locale) || (typeof p.title === "string" ? p.title : "");
                            // 写真ページ（PhotoPageClient の shotAt）と同じ整形。
                            // 以前は生の値（"2024-10-12T08:30:15+09:00" 等）を
                            // そのまま出していた。整形できない値は出さない。
                            // exif 側が整形できない文字列でも、有効な date が
                            // あればそちらを出す（|| で先に選ぶと丸ごと消える）。
                            const lc = isJa ? "ja" as const : "en" as const;
                            const dateText = formatStoredDateTime(p.exif?.dateTimeOriginal, lc)
                                ?? formatStoredDateTime(p.date, lc) ?? "";
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
                                                src={publicImageUrl(p.thumbSrc || p.src)}
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
                                            <p className="text-[11px] text-white/50 truncate">
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
