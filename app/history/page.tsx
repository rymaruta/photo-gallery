"use client";

import React from "react";
import { useViewHistory } from "../../lib/hooks/useViewHistory";
import { useImagePreloader } from "../../lib/hooks/useImagePreloader";
import type { Photo } from "../data/photos";
import GalleryGrid from "../components/GalleryGrid";
import GalleryModal from "../components/GalleryModal";
import LocaleToggle from "../components/LocaleToggle";
import { useLocale } from "../i18n/context";
import { capitalize } from "../../lib/utils/string";
import { log } from "../../lib/utils/log";
import { publicFetch, PUBLIC_FETCH_TIMEOUT_MS } from "../../lib/utils/api";

export default function HistoryPage() {
    const { locale, setLocale, labels } = useLocale();
    const { history, clearHistory } = useViewHistory();
    const { preloadMultiple } = useImagePreloader();
    const [allPhotos, setAllPhotos] = React.useState<Photo[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState(false);
    const [loadErrorTimeout, setLoadErrorTimeout] = React.useState(false);

    const loadPhotos = React.useCallback(async () => {
        setLoadError(false);
        setLoadErrorTimeout(false);
        setLoading(true);
        try {
            const response = await publicFetch("/photos", { cache: "no-store" }, PUBLIC_FETCH_TIMEOUT_MS);
            if (response.ok) {
                const data = await response.json();
                setAllPhotos(data);
            } else {
                log.error("写真の取得に失敗しました");
                setLoadError(true);
            }
        } catch (error) {
            const isTimeout = error instanceof Error && error.name === "AbortError";
            log.error(isTimeout ? "写真取得がタイムアウトしました" : "写真取得エラー:", error);
            setLoadErrorTimeout(isTimeout);
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        loadPhotos();
    }, [loadPhotos]);

    // モーダル管理
    const [currentIndex, setCurrentIndex] = React.useState<number | null>(null);

    // 閲覧履歴の写真を取得（閲覧日時の新しい順）
    const historyPhotos = React.useMemo(() => {
        const historyMap = new Map<string, string>();
        history.forEach(item => {
            historyMap.set(item.photoId, item.viewedAt);
        });

        // 履歴の順序を保持しながら写真を取得
        const photos = history
            .map(item => {
                const photo = allPhotos.find(p => p.id === item.photoId);
                return photo ? { photo, viewedAt: item.viewedAt } : null;
            })
            .filter((item): item is { photo: Photo; viewedAt: string } => item !== null)
            .map(item => item.photo);

        return photos;
    }, [history, allPhotos]);

    // モーダル操作
    const openModal = React.useCallback((index: number) => {
        setCurrentIndex(index);
    }, []);

    const closeModal = React.useCallback(() => {
        setCurrentIndex(null);
    }, []);

    const nextPhoto = React.useCallback(() => {
        setCurrentIndex((i) =>
            i === null ? null : historyPhotos.length ? (i + 1) % historyPhotos.length : null
        );
    }, [historyPhotos.length]);

    const prevPhoto = React.useCallback(() => {
        setCurrentIndex((i) =>
            i === null ? null : historyPhotos.length ? (i - 1 + historyPhotos.length) % historyPhotos.length : null
        );
    }, [historyPhotos.length]);

    // 閲覧履歴の画像をプリロード
    React.useEffect(() => {
        if (historyPhotos.length > 0) {
            const imageSrcs = historyPhotos.map(p => p.src);
            // 最初の10枚を優先的にプリロード
            preloadMultiple(imageSrcs.slice(0, 10));
        }
    }, [historyPhotos, preloadMultiple]);

    const categoryDisplayMap = React.useMemo(() => {
        const map: Record<string, string> = {};
        const names = labels.category.names ?? {};
        for (const p of historyPhotos) {
            const k = (p.category ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");
            if (k && !map[k]) {
                map[k] = names[k] ?? capitalize(k.replace(/-/g, " "));
            }
        }
        return map;
    }, [labels, historyPhotos]);

    const handleClearHistory = () => {
        clearHistory();
    };

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6 min-h-[64px]">
                <div className="flex-1">
                    <h1 id="site-title" className="text-2xl sm:text-3xl font-bold mb-0">
                        {locale === "en" ? "Viewing History" : "閲覧履歴"}
                    </h1>
                    <p className="text-sm text-white/60 mt-1">
                        {locale === "en"
                            ? `${historyPhotos.length} viewed photo${historyPhotos.length !== 1 ? "s" : ""}`
                            : `${historyPhotos.length} 件の閲覧履歴`}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {historyPhotos.length > 0 && (
                        <button
                            onClick={handleClearHistory}
                            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-white/80 rounded-md transition-colors"
                            aria-label={locale === "en" ? "Clear history" : "履歴をクリア"}
                        >
                            {locale === "en" ? "Clear History" : "履歴をクリア"}
                        </button>
                    )}
                    <div className="flex-shrink-0">
                        <LocaleToggle
                            locale={locale}
                            setLocale={setLocale}
                            labels={labels.ui?.language ?? { ja: "日本語", en: "English" }}
                        />
                    </div>
                </div>
            </div>

            {loading && !loadError ? (
                <div className="flex items-center justify-center py-12">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" aria-hidden />
                </div>
            ) : loadError ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-white/80 mb-4">
                        {loadErrorTimeout
                            ? (locale === "en" ? "Request timed out (8s). Please try again." : "接続がタイムアウトしました（8秒）。しばらくしてから再試行してください。")
                            : (locale === "en" ? "Failed to load photos." : "写真の読み込みに失敗しました")}
                    </p>
                    <button
                        type="button"
                        onClick={() => loadPhotos()}
                        className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                    >
                        {locale === "en" ? "Retry" : "再試行"}
                    </button>
                </div>
            ) : historyPhotos.length === 0 ? (
                <div className="text-center py-12">
                    <svg
                        className="w-16 h-16 mx-auto mb-4 text-white/40"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    </svg>
                    <p className="text-white/60">
                        {locale === "en" ? "No viewing history yet." : "閲覧履歴はまだありません。"}
                    </p>
                </div>
            ) : (
                <>
                    <GalleryGrid
                        photos={historyPhotos}
                        onOpen={openModal}
                        locale={locale}
                        categoryDisplayMap={categoryDisplayMap}
                    />
                    {currentIndex !== null && historyPhotos[currentIndex] && (
                        <GalleryModal
                            photos={historyPhotos}
                            currentIndex={currentIndex}
                            onClose={closeModal}
                            onNext={nextPhoto}
                            onPrev={prevPhoto}
                            locale={locale}
                            categoryDisplayMap={categoryDisplayMap}
                        />
                    )}
                </>
            )}
        </main>
    );
}
