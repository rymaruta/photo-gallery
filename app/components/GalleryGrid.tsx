import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Photo, Locale } from "../data/photos";
import { getLocalized } from "../data/photos";
import { getLabels } from "../i18n/labels";
import { useFavorites } from "../../lib/hooks/useFavorites";
import { HeartIcon } from "@heroicons/react/24/solid";

/** 画面内（または手前）に入ったときだけ画像を読み込む。先頭は即表示、それ以外はスクロールで表示 */
const IN_VIEW_INITIAL_COUNT = 24; // 先頭から十分な件数を最初から表示し、LCP・灰色化を防ぐ

function useInView(index: number, enabled: boolean) {
    const [inView, setInView] = useState(index < IN_VIEW_INITIAL_COUNT);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!enabled || index < IN_VIEW_INITIAL_COUNT) return;
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting) setInView(true);
            },
            { rootMargin: "400px 0px", threshold: 0 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [enabled, index]);

    return { inView, ref };
}

/** 遅延読み込み時のぼかしプレースホルダー用（10x10 グレー SVG） */
const DEFAULT_BLUR_DATA_URL =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMWExYTFhIi8+PC9zdmc+";

/** dominantColor から 10x10 の単色 SVG を data URL で生成（体感速度向上のため画像に近い色でプレースホルダー表示） */
function getBlurDataUrl(hexColor: string | undefined): string {
    if (!hexColor || !/^#([0-9A-Fa-f]{3}){1,2}$/.test(hexColor)) return DEFAULT_BLUR_DATA_URL;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${hexColor}"/></svg>`;
    if (typeof btoa !== "undefined") {
        const encoded = encodeURIComponent(svg).replace(
            /%([0-9A-F]{2})/g,
            (_, hex) => String.fromCharCode(parseInt(hex, 16))
        );
        return `data:image/svg+xml;base64,${btoa(encoded)}`;
    }
    return DEFAULT_BLUR_DATA_URL;
}

type Props = {
    photos: Photo[];
    /** 指定時はクリックで詳細ページへ遷移。未指定時は onOpen でモーダルを開く */
    linkToDetailPage?: boolean;
    onOpen?: (index: number) => void;
    locale: Locale;
    categoryDisplayMap?: Record<string, string>;
};

export default function GalleryGrid({
    photos,
    linkToDetailPage = false,
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
                const placeholderColor = p.dominantColor ?? "#2a2a2a";
                const objectPosition =
                    p.focalPoint ? `${Math.round(p.focalPoint.x * 100)}% ${Math.round(p.focalPoint.y * 100)}%` : undefined;

                const blurDataURL = getBlurDataUrl(p.dominantColor);
                return (
                    <GalleryItem
                        key={p.id ?? `photo-${idx}`}
                        photo={p}
                        index={idx}
                        locale={locale}
                        localizedTitle={localizedTitle}
                        localizedAlt={localizedAlt}
                        placeholderColor={placeholderColor}
                        blurDataURL={blurDataURL}
                        objectPosition={objectPosition}
                        categoryDisplayMap={categoryDisplayMap}
                        linkToDetailPage={linkToDetailPage}
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
    locale,
    localizedTitle,
    localizedAlt,
    placeholderColor,
    blurDataURL,
    objectPosition,
    categoryDisplayMap,
    linkToDetailPage,
    onOpen,
}: {
    photo: Photo;
    index: number;
    locale: Locale;
    localizedTitle: string;
    localizedAlt: string;
    placeholderColor: string;
    blurDataURL: string;
    objectPosition?: string;
    categoryDisplayMap?: Record<string, string>;
    linkToDetailPage: boolean;
    onOpen?: (index: number) => void;
}) {
    const [imageError, setImageError] = useState(false);
    const { inView, ref: inViewRef } = useInView(index, true);
    const { isFavorite } = useFavorites();
    const isFav = isFavorite(photo.id);

    // 詳細ページへリンクするとき、カードが画面内に入ったら画像をプリロード（詳細表示を速くする）
    useEffect(() => {
        if (!linkToDetailPage || !inView || !photo?.src) return;
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "image";
        link.href = photo.src;
        document.head.appendChild(link);
        return () => {
            try {
                link.remove();
            } catch {
                /* ignore */
            }
        };
    }, [linkToDetailPage, inView, photo?.src]);

    const openLabel =
        locale === "ja"
            ? (localizedTitle ? `${localizedTitle}を開く` : "写真を開く")
            : (localizedTitle ? `Open ${localizedTitle}` : "Open photo");

    const cardClass = "block w-full p-0 border-0 bg-transparent cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30";
    const cardStyle = { touchAction: "manipulation" as const, WebkitTapHighlightColor: "transparent" };

    const content = (
        <>
                <div
                    className="relative w-full overflow-hidden"
                    style={{ paddingTop: "75%", backgroundColor: placeholderColor, fontSize: 0, lineHeight: 0 }}
                >
                    {/* クリックを親に通すため pointer-events: none */}
                    <div className="absolute inset-0 pointer-events-none" aria-hidden />

                    {!imageError && inView && Boolean(photo.src) ? (
                        <Image
                            src={photo.src}
                            alt={localizedAlt}
                            fill
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                            className="object-cover pointer-events-none"
                            style={objectPosition ? { objectPosition } : undefined}
                            placeholder="blur"
                            blurDataURL={blurDataURL}
                            priority={index < 2}
                            onError={() => setImageError(true)}
                        />
                    ) : !imageError ? (
                        <div className="absolute inset-0 animate-pulse bg-white/15 pointer-events-none" aria-hidden />
                    ) : null}
                    {imageError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 pointer-events-none">
                            <div className="text-white/40 text-xs text-center px-4">
                                <svg className="w-8 h-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <p>画像を読み込めません</p>
                            </div>
                        </div>
                    )}

                                {/* お気に入りアイコン（表示のみ・クリックは親に通す） */}
                                {isFav && (
                                    <div className="absolute top-2 right-2 z-10 pointer-events-none">
                                        <HeartIcon className="w-4 h-4 sm:w-5 sm:h-5 text-red-500 drop-shadow-lg" />
                                    </div>
                                )}

                                <div
                                    className="absolute left-0 right-0 bottom-0 px-2 pointer-events-none"
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
        </>
    );

    return (
        <div className="w-full m-0 p-0" ref={inViewRef}>
            {linkToDetailPage ? (
                <Link
                    href={`/photo/${photo.id}`}
                    className={cardClass}
                    aria-label={openLabel}
                    title={localizedTitle}
                    style={cardStyle}
                    data-photo-id={photo.id}
                >
                    {content}
                </Link>
            ) : (
                <button
                    type="button"
                    onClick={() => onOpen?.(index)}
                    className={cardClass}
                    aria-label={openLabel}
                    title={localizedTitle}
                    style={cardStyle as React.CSSProperties}
                    data-photo-id={photo.id}
                >
                    {content}
                </button>
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.photo.id === nextProps.photo.id &&
        prevProps.index === nextProps.index &&
        prevProps.locale === nextProps.locale &&
        prevProps.localizedTitle === nextProps.localizedTitle &&
        prevProps.placeholderColor === nextProps.placeholderColor &&
        prevProps.blurDataURL === nextProps.blurDataURL &&
        prevProps.objectPosition === nextProps.objectPosition &&
        prevProps.linkToDetailPage === nextProps.linkToDetailPage &&
        prevProps.categoryDisplayMap?.[prevProps.photo.category ?? ""] === nextProps.categoryDisplayMap?.[nextProps.photo.category ?? ""]
    );
});
