"use client";

import React from "react";
import { useViewHistory } from "../../lib/hooks/useViewHistory";
import { useImagePreloader } from "../../lib/hooks/useImagePreloader";
import { usePhotos } from "../../lib/hooks/usePhotos";
import type { Photo } from "../../lib/data/photos";
import GalleryGrid from "../components/GalleryGrid";
import GalleryModal from "../components/GalleryModal";
import LocaleToggle from "../components/LocaleToggle";
import { useLocale } from "../i18n/context";
import { capitalize } from "../../lib/utils/string";

export default function HistoryPage() {
    const { locale, setLocale, labels } = useLocale();
    const { history, clearHistory } = useViewHistory();
    const { preloadMultiple } = useImagePreloader();
    const { photos: allPhotos } = usePhotos();

    // モーダル管理
    const [currentIndex, setCurrentIndex] = React.useState<number | null>(null);

    // 閲覧履歴の写真を取得（閲覧日時の新しい順）
    const historyPhotos = React.useMemo(() => {
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

            {historyPhotos.length === 0 ? (
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
