"use client";

import React from "react";
import { HeartIcon } from "@heroicons/react/24/solid";
import { useFavorites } from "../../lib/hooks/useFavorites";
import { useImagePreloader } from "../../lib/hooks/useImagePreloader";
import { usePhotos } from "../../lib/hooks/usePhotos";
import GalleryGrid from "../components/GalleryGrid";
import { useLocale } from "../i18n/context";
import { capitalize } from "../../lib/utils/string";
import { slugify } from "../../lib/utils/collections";

export default function FavoritesPage() {
    const { locale, labels } = useLocale();
    const { favorites } = useFavorites();
    const { preloadMultiple } = useImagePreloader();
    const { photos: allPhotos } = usePhotos();

    // いいねした写真を取得
    const favoritePhotos = React.useMemo(() => {
        const favoriteSet = new Set(favorites);
        return allPhotos.filter((p) => favoriteSet.has(p.id));
    }, [favorites, allPhotos]);

    // お気に入りの画像をプリロード
    React.useEffect(() => {
        if (favoritePhotos.length > 0) {
            const imageSrcs = favoritePhotos.map(p => p.thumbSrc ?? p.src);
            // 最初の10枚を優先的にプリロード
            preloadMultiple(imageSrcs.slice(0, 10));
        }
    }, [favoritePhotos, preloadMultiple]);

    const categoryDisplayMap = React.useMemo(() => {
        const map: Record<string, string> = {};
        const names = labels.category.names ?? {};
        for (const p of favoritePhotos) {
            // **鍵の作り方は `slugify` に任せる。** ここで手書きに正規化すると
            // 別名（建物 → architecture）が寄らず、表示名の表にも当たらない
            // ——同じ規則がリポジトリに3通りある状態だった
            const k = slugify((p.category ?? "").toString(), "category");
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
                        {locale === "en" ? "Liked Photos" : "いいねした写真"}
                    </h1>
                    <p className="text-sm text-white/60 mt-1">
                        {locale === "en"
                            ? `${favoritePhotos.length} liked photo${favoritePhotos.length !== 1 ? "s" : ""}`
                            : `いいねした写真 ${favoritePhotos.length} 件`}
                    </p>
                </div>

            </div>

            {favoritePhotos.length === 0 ? (
                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 flex flex-col items-center justify-center gap-3 text-center">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                        <HeartIcon className="w-8 h-8 text-white/30" />
                    </div>
                    <p className="text-white/70 text-sm">
                        {locale === "en" ? "No liked photos yet." : "いいねした写真はまだありません。"}
                    </p>
                    <p className="text-white/50 text-xs">
                        {locale === "en" ? "Tap the heart on a photo and it will be collected here." : "写真のハート（いいね）を押すとここに集まります。"}
                    </p>
                </div>
            ) : (
                <GalleryGrid
                    photos={favoritePhotos}
                    locale={locale}
                    categoryDisplayMap={categoryDisplayMap}
                />
            )}
        </main>
    );
}
