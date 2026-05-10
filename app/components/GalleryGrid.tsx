import React, { useState } from "react";
import Image from "next/image";
import type { Photo, Locale } from "../data/photos";
import { getLocalized } from "../data/photos";
import { getLabels } from "../i18n/labels";
import { useFavorites } from "../../lib/hooks/useFavorites";
import { HeartIcon } from "@heroicons/react/24/solid";

type Props = {
    photos: Photo[];
    onOpen: (index: number) => void;
    locale: Locale;
    categoryDisplayMap?: Record<string, string>;
};

export default function GalleryGrid({
    photos,
    onOpen,
    locale,
    categoryDisplayMap = {},
}: Props) {
    const labels = React.useMemo(() => getLabels(locale), [locale]);
    const emptyMessage = labels.gallery?.emptyMessage ?? (locale === "en" ? "No photos found." : "該当する写真がありません。");

    if (!photos || photos.length === 0) {
        return <div className="text-sm text-white/70">{emptyMessage}</div>;
    }

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-0">
            {photos.map((p, idx) => {
                const localizedTitle = getLocalized(p.title, locale) || (typeof p.title === "string" ? p.title : "");
                const localizedAlt = getLocalized(p.alt, locale) || localizedTitle || "";
                const placeholderColor = p.dominantColor ?? "#111";
                const objectPosition =
                    p.focalPoint ? `${Math.round(p.focalPoint.x * 100)}% ${Math.round(p.focalPoint.y * 100)}%` : undefined;

                return (
                    <GalleryItem
                        key={p.id}
                        photo={p}
                        index={idx}
                        localizedTitle={localizedTitle}
                        localizedAlt={localizedAlt}
                        placeholderColor={placeholderColor}
                        objectPosition={objectPosition}
                        categoryDisplayMap={categoryDisplayMap}
                        onOpen={onOpen}
                    />
                );
            })}
        </div>
    );
}

// 個別のギャラリーアイテムコンポーネント（エラーハンドリング用、メモ化）
const GalleryItem = React.memo(function GalleryItem({
    photo,
    index,
    localizedTitle,
    localizedAlt,
    placeholderColor,
    objectPosition,
    categoryDisplayMap,
    onOpen,
}: {
    photo: Photo;
    index: number;
    localizedTitle: string;
    localizedAlt: string;
    placeholderColor: string;
    objectPosition?: string;
    categoryDisplayMap?: Record<string, string>;
    onOpen: (index: number) => void;
}) {
    const [imageError, setImageError] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const { isFavorite } = useFavorites();
    const isFav = isFavorite(photo.id);
    const isPriority = index < 8;

    return (
        <div className="w-full m-0 p-0">
            {/* href でクローラーが /photo/[id] を発見できるようにしつつ、クリックはモーダルで開く */}
            <a
                href={`/photo/${photo.id}`}
                onClick={(e) => { e.preventDefault(); onOpen(index); }}
                className="block w-full p-0 border-0 bg-transparent cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                aria-label={localizedTitle ? `${localizedTitle} を開く` : "写真を開く"}
                title={localizedTitle}
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
                data-photo-id={photo.id}
            >
                <div
                    className="relative w-full overflow-hidden"
                    style={{ paddingTop: "75%", backgroundColor: placeholderColor, fontSize: 0, lineHeight: 0 }}
                >
                    <div className="absolute inset-0" aria-hidden={true} />

                    {!imageError ? (
                        <Image
                            src={photo.src}
                            alt={localizedAlt}
                            fill
                            className="object-cover transition-opacity duration-300"
                            style={{
                                ...(objectPosition ? { objectPosition } : {}),
                                opacity: imageLoaded ? 1 : 0,
                            }}
                            sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                            loading={isPriority ? "eager" : "lazy"}
                            priority={isPriority}
                            onError={() => setImageError(true)}
                            onLoad={() => setImageLoaded(true)}
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                            <div className="text-white/40 text-xs text-center px-4">
                                <svg className="w-8 h-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <p>画像を読み込めません</p>
                            </div>
                        </div>
                    )}

                                {/* お気に入りアイコン */}
                                {isFav && (
                                    <div className="absolute top-2 right-2 z-10">
                                        <HeartIcon className="w-4 h-4 sm:w-5 sm:h-5 text-red-500 drop-shadow-lg" />
                                    </div>
                                )}

                                <div
                                    className="absolute left-0 right-0 bottom-0 px-2"
                                    style={{
                                        background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%)",
                                    }}
                                >
                                    <div className="py-1 sm:py-2">
                                        <div
                                            className="text-sm font-semibold text-white truncate"
                                            title={localizedTitle}
                                        >
                                            {localizedTitle}
                                        </div>
                                        <div
                                            className="text-xs text-white/60 truncate"
                                            title={categoryDisplayMap?.[photo.category ?? ""] || ""}
                                        >
                                            {categoryDisplayMap?.[photo.category ?? ""]}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </a>
                    </div>
                );
});
