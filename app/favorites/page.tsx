"use client";

import React from "react";
import { useFavorites } from "../../lib/hooks/useFavorites";
import { useImagePreloader } from "../../lib/hooks/useImagePreloader";
import type { Photo } from "../data/photos";
import GalleryGrid from "../components/GalleryGrid";
import GalleryModal from "../components/GalleryModal";
import LocaleToggle from "../components/LocaleToggle";
import { useLocale } from "../i18n/context";
import { capitalize } from "../../lib/utils/string";
import { log } from "../../lib/utils/log";

export default function FavoritesPage() {
    const { locale, setLocale, labels } = useLocale();
    const { favorites } = useFavorites();
    const { preloadMultiple } = useImagePreloader();
    const [allPhotos, setAllPhotos] = React.useState<Photo[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState(false);

    const loadPhotos = React.useCallback(async () => {
        setLoadError(false);
        setLoading(true);
        try {
            const { publicFetch } = await import("../../lib/utils/api");
            const response = await publicFetch("/photos", { cache: "no-store" });
            if (response.ok) {
                const data = await response.json();
                setAllPhotos(data);
            } else {
                log.error("写真の取得に失敗しました");
                setLoadError(true);
            }
        } catch (error) {
            log.error("写真取得エラー:", error);
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

    // お気に入りの写真を取得
    const favoritePhotos = React.useMemo(() => {
        const favoriteSet = new Set(favorites);
        return allPhotos.filter((p) => favoriteSet.has(p.id));
    }, [favorites, allPhotos]);

    // モーダル操作
    const openModal = React.useCallback((index: number) => {
        setCurrentIndex(index);
    }, []);

    const closeModal = React.useCallback(() => {
        setCurrentIndex(null);
    }, []);

    const nextPhoto = React.useCallback(() => {
        setCurrentIndex((i) =>
            i === null ? null : favoritePhotos.length ? (i + 1) % favoritePhotos.length : null
        );
    }, [favoritePhotos.length]);

    const prevPhoto = React.useCallback(() => {
        setCurrentIndex((i) =>
            i === null ? null : favoritePhotos.length ? (i - 1 + favoritePhotos.length) % favoritePhotos.length : null
        );
    }, [favoritePhotos.length]);

    // お気に入りの画像をプリロード
    React.useEffect(() => {
        if (favoritePhotos.length > 0) {
            const imageSrcs = favoritePhotos.map(p => p.src);
            // 最初の10枚を優先的にプリロード
            preloadMultiple(imageSrcs.slice(0, 10));
        }
    }, [favoritePhotos, preloadMultiple]);

    const categoryDisplayMap = React.useMemo(() => {
        const map: Record<string, string> = {};
        const names = labels.category.names ?? {};
        for (const p of favoritePhotos) {
            const k = (p.category ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");
            if (k && !map[k]) {
                map[k] = names[k] ?? capitalize(k.replace(/-/g, " "));
            }
        }
        return map;
    }, [labels, favoritePhotos]);

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6 min-h-[64px]">
                <div className="flex-1">
                    <h1 id="site-title" className="text-2xl sm:text-3xl font-bold mb-0">
                        {locale === "en" ? "Favorites" : "お気に入り"}
                    </h1>
                    <p className="text-sm text-white/60 mt-1">
                        {locale === "en"
                            ? `${favoritePhotos.length} favorite photo${favoritePhotos.length !== 1 ? "s" : ""}`
                            : `${favoritePhotos.length} 件のお気に入り`}
                    </p>
                </div>

                <div className="flex-shrink-0">
                    <LocaleToggle
                        locale={locale}
                        setLocale={setLocale}
                        labels={labels.ui?.language ?? { ja: "日本語", en: "English" }}
                    />
                </div>
            </div>

            {loading && !loadError ? (
                <div className="flex items-center justify-center py-12">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" aria-hidden />
                </div>
            ) : loadError ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-white/80 mb-4">
                        {locale === "en" ? "Failed to load photos." : "写真の読み込みに失敗しました"}
                    </p>
                    <button
                        type="button"
                        onClick={() => loadPhotos()}
                        className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                    >
                        {locale === "en" ? "Retry" : "再試行"}
                    </button>
                </div>
            ) : favoritePhotos.length === 0 ? (
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
                            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                        />
                    </svg>
                    <p className="text-white/60">
                        {locale === "en" ? "No favorites yet." : "お気に入りはまだありません。"}
                    </p>
                </div>
            ) : (
                <>
                    <GalleryGrid
                        photos={favoritePhotos}
                        onOpen={openModal}
                        locale={locale}
                        categoryDisplayMap={categoryDisplayMap}
                    />
                    {currentIndex !== null && favoritePhotos[currentIndex] && (
                        <GalleryModal
                            photos={favoritePhotos}
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
