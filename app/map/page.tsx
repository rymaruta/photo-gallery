"use client";

import React, { useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeftIcon, MapPinIcon } from "@heroicons/react/24/outline";
import { useLocale } from "../i18n/context";
import { usePhotos } from "../../lib/hooks/usePhotos";

// Leaflet は window 依存のため SSG では読み込まない
const MapView = dynamic(() => import("../components/MapView"), {
    ssr: false,
    loading: () => (
        <div className="w-full h-full flex items-center justify-center">
            <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
    ),
});

export default function MapPage() {
    const { locale } = useLocale();
    const { photos } = usePhotos();

    const photosWithCoords = useMemo(
        () => photos.filter((p) => p.coords && p.published !== false),
        [photos],
    );

    return (
        <main className="min-h-screen bg-black text-white flex flex-col">
            <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 md:px-8 pt-4 pb-3 flex items-center justify-between gap-3">
                <div>
                    <Link
                        href="/"
                        className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
                    >
                        <ArrowLeftIcon className="w-3 h-3" />
                        {locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}
                    </Link>
                    <h1 className="text-xl sm:text-2xl font-bold mt-1">
                        {locale === "en" ? "Photo Map" : "撮影地マップ"}
                    </h1>
                </div>
                <p className="text-xs text-white/40 text-right">
                    <MapPinIcon className="w-3.5 h-3.5 inline -mt-0.5" />{" "}
                    {locale === "en"
                        ? `${photosWithCoords.length} photo(s) on the map`
                        : `${photosWithCoords.length} 枚の写真`}
                </p>
            </div>

            {/* マップ本体 */}
            <div className="flex-1 min-h-[70vh] relative">
                <MapView photos={photosWithCoords} locale={locale} />
                {photosWithCoords.length === 0 && (
                    <div className="absolute inset-x-0 top-4 z-[1000] flex justify-center pointer-events-none">
                        <p className="bg-black/80 backdrop-blur px-4 py-2 rounded-full text-xs text-white/70">
                            {locale === "en"
                                ? "Photos with location data will appear here."
                                : "位置情報つきでアップロードされた写真がここに表示されます"}
                        </p>
                    </div>
                )}
            </div>
        </main>
    );
}
