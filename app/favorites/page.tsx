"use client";

import React from "react";
import { HeartIcon } from "@heroicons/react/24/solid";
import { useFavorites } from "../../lib/hooks/useFavorites";
import { useImagePreloader } from "../../lib/hooks/useImagePreloader";
import { usePhotos } from "../../lib/hooks/usePhotos";
import GalleryGrid from "../components/GalleryGrid";
import GalleryModal from "../components/GalleryModal";
import LocaleToggle from "../components/LocaleToggle";
import { useLocale } from "../i18n/context";
import { capitalize } from "../../lib/utils/string";

export default function FavoritesPage() {
    const { locale, setLocale, labels } = useLocale();
    const { favorites } = useFavorites();
    const { preloadMultiple } = useImagePreloader();
    const { photos: allPhotos } = usePhotos();

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

            {favoritePhotos.length === 0 ? (
                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 flex flex-col items-center justify-center gap-3 text-center">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                        <HeartIcon className="w-8 h-8 text-white/30" />
                    </div>
                    <p className="text-white/70 text-sm">
                        {locale === "en" ? "No favorites yet." : "お気に入りはまだありません。"}
                    </p>
                    <p className="text-white/40 text-xs">
                        {locale === "en" ? "Tap the heart on a photo to save it here." : "写真のハートを押すとここに保存されます。"}
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
