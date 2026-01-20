"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import { HeartIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartIconOutline } from "@heroicons/react/24/outline";
import { ShareIcon, LinkIcon } from "@heroicons/react/24/outline";
import exifr from "exifr";
import type { Photo } from "../../data/photos";
import { getLocalized, getLocalizedParagraphs, getPreferredMapLink, makeGoogleSearch } from "../../data/photos";
import { useFavorites } from "../../../lib/hooks/useFavorites";
import { useViewHistory } from "../../../lib/hooks/useViewHistory";
import { useToast } from "../../../lib/hooks/useToast";
import { shareUrl, copyToClipboard, shareToTwitter, shareToFacebook, shareToLine } from "../../../lib/utils/share";
import { siteConfig, generatePhotoStructuredData } from "../../../lib/utils/seo";
import LocaleToggle from "../../components/LocaleToggle";
import { useLocale } from "../../i18n/context";

// EXIF情報の型定義
type ExtractedExif = {
    Make?: string;
    Model?: string;
    LensModel?: string;
    FNumber?: number;
    ExposureTime?: number;
    ISO?: number;
    FocalLength?: number;
    WhiteBalance?: number;
    DateTimeOriginal?: string;
    ImageWidth?: number;
    ImageHeight?: number;
    Orientation?: number;
};

// 画像コンポーネント（エラーハンドリング付き、EXIF読み取り機能付き）
function PhotoImage({ 
    src, 
    alt, 
    focalPoint,
    onExifLoaded 
}: { 
    src: string; 
    alt: string; 
    focalPoint?: { x: number; y: number };
    onExifLoaded?: (exif: ExtractedExif | null) => void;
}) {
    const [imageError, setImageError] = useState(false);
    const [imageLoading, setImageLoading] = useState(true);

    // EXIF情報を読み取る（画像が読み込まれた後）
    useEffect(() => {
        if (imageLoading || imageError) return;

        const loadExif = async () => {
            try {
                // S3のURLや外部URLの場合でもCORSエラーを適切にハンドリング
                // exifrはURL、Blob、ArrayBufferを受け取れる
                let imageData: string | Blob | ArrayBuffer = src;
                
                // S3のURL（http/httpsで始まる）の場合、CORSが設定されていれば直接URLを使用
                // CORSエラーが発生する可能性があるため、まずURLを直接試し、失敗した場合はfetchで取得
                if (src.startsWith('http://') || src.startsWith('https://')) {
                    try {
                        // まずURLを直接試す（CORSが正しく設定されていれば動作する）
                        const exif = await exifr.parse(src, {
                            pick: [
                                'Make',
                                'Model',
                                'LensModel',
                                'FNumber',
                                'ExposureTime',
                                'ISO',
                                'FocalLength',
                                'WhiteBalance',
                                'DateTimeOriginal',
                                'ImageWidth',
                                'ImageHeight',
                                'Orientation'
                            ],
                            translateKeys: false,
                        });
                        onExifLoaded?.(exif || null);
                        return;
                    } catch (urlError) {
                        // URL直接読み取りに失敗した場合、fetchで取得を試みる
                        try {
                            const response = await fetch(src, {
                                mode: 'cors',
                                credentials: 'omit',
                            });
                            if (response.ok) {
                                const blob = await response.blob();
                                const exif = await exifr.parse(blob, {
                                    pick: [
                                        'Make',
                                        'Model',
                                        'LensModel',
                                        'FNumber',
                                        'ExposureTime',
                                        'ISO',
                                        'FocalLength',
                                        'WhiteBalance',
                                        'DateTimeOriginal',
                                        'ImageWidth',
                                        'ImageHeight',
                                        'Orientation'
                                    ],
                                    translateKeys: false,
                                });
                                onExifLoaded?.(exif || null);
                                return;
                            }
                        } catch (fetchError) {
                            // fetchも失敗した場合はURLを直接使用（最終試行）
                            console.warn('Failed to fetch image for EXIF, trying URL directly:', fetchError);
                        }
                    }
                }
                
                // ローカルパス（/images/で始まる）の場合はURLを直接使用
                const exif = await exifr.parse(src, {
                    pick: [
                        'Make',
                        'Model',
                        'LensModel',
                        'FNumber',
                        'ExposureTime',
                        'ISO',
                        'FocalLength',
                        'WhiteBalance',
                        'DateTimeOriginal',
                        'ImageWidth',
                        'ImageHeight',
                        'Orientation'
                    ],
                    translateKeys: false,
                });
                onExifLoaded?.(exif || null);
            } catch (error) {
                // EXIF読み取りに失敗した場合はnullを返す（photo.exifをフォールバックとして使用）
                console.warn('Failed to read EXIF data from image:', error);
                onExifLoaded?.(null);
            }
        };

        loadExif();
    }, [imageLoading, imageError, src, onExifLoaded]);

    if (imageError) {
        return (
            <div className="flex items-center justify-center bg-black min-h-[400px] rounded-lg">
                <div className="text-white/60 text-center px-4">
                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm">画像を読み込めません</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ minHeight: "400px", position: "relative" }}>
            {imageLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
                    <div className="w-12 h-12 border-3 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            )}
            <div className="relative w-full bg-black" style={{ minHeight: "400px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Image
                    src={src}
                    alt={alt}
                    width={1200}
                    height={800}
                    className="w-full h-auto object-contain max-h-[80vh]"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 90vw, 1200px"
                    priority
                    style={{
                        ...(focalPoint ? { objectPosition: `${focalPoint.x * 100}% ${focalPoint.y * 100}%` } : {}),
                    }}
                    onError={() => {
                        setImageError(true);
                        setImageLoading(false);
                    }}
                    onLoad={() => setImageLoading(false)}
                />
            </div>
        </div>
    );
}

type PhotoPageClientProps = {
    photoId: string;
};

export default function PhotoPageClient({ photoId }: PhotoPageClientProps) {
    const { locale, setLocale, labels } = useLocale();
    const [extractedExif, setExtractedExif] = useState<ExtractedExif | null>(null);
    const [allPhotos, setAllPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);

    // APIから写真を読み込む（編集済みのベース写真も含む）
    useEffect(() => {
        const loadPhotos = async () => {
            try {
                const { publicFetch } = await import("../../../lib/utils/api");
                const response = await publicFetch("/photos", { cache: "no-store" });
                if (response.ok) {
                    const data = await response.json();
                    setAllPhotos(data);
                } else {
                    console.error("写真の取得に失敗しました");
                }
            } catch (error) {
                console.error("写真取得エラー:", error);
            } finally {
                setLoading(false);
            }
        };

        loadPhotos();
    }, []);

    // 全写真から該当する写真を検索
    const photo = useMemo(() => {
        return allPhotos.find(p => p.id === photoId);
    }, [photoId, allPhotos]);

    // 全写真のインデックスを取得（前後の写真へのナビゲーション用）
    const currentIndex = useMemo(() => {
        return allPhotos.findIndex(p => p.id === photoId);
    }, [photoId, allPhotos]);

    const prevPhoto = currentIndex > 0 ? allPhotos[currentIndex - 1] : null;
    const nextPhoto = currentIndex < allPhotos.length - 1 ? allPhotos[currentIndex + 1] : null;

    // お気に入り機能
    const { isFavorite, toggleFavorite } = useFavorites();
    const isFav = photo ? isFavorite(photo.id) : false;

    // 閲覧履歴機能
    const { addToHistory } = useViewHistory();

    // トースト通知
    const { showToast } = useToast();

    // 写真が表示されたときに閲覧履歴に追加
    useEffect(() => {
        if (photo?.id) {
            addToHistory(photo.id);
        }
    }, [photo?.id, addToHistory]);

    // EXIF情報を画像から読み取った情報を優先し、なければデータ側のexifをフォールバック
    const mergedExif = useMemo(() => {
        const extracted = extractedExif || {};
        const fallback = photo?.exif || {};
        
        // 画像サイズの生成（優先順位: extracted > photo.width/height > fallback.imageSize）
        let imageSize: string | undefined;
        if (extracted.ImageWidth && extracted.ImageHeight) {
            imageSize = `${extracted.ImageWidth} × ${extracted.ImageHeight}`;
        } else if (photo?.width && photo?.height) {
            imageSize = `${photo.width} × ${photo.height}`;
        } else if (fallback.imageSize) {
            imageSize = fallback.imageSize;
        }
        
        return {
            camera: extracted.Make && extracted.Model 
                ? `${extracted.Make} ${extracted.Model}`.trim() 
                : extracted.Make || extracted.Model || fallback.camera || undefined,
            lens: extracted.LensModel || fallback.lens || undefined,
            aperture: extracted.FNumber 
                ? `f/${extracted.FNumber}` 
                : fallback.aperture || undefined,
            exposure: extracted.ExposureTime 
                ? extracted.ExposureTime < 1 
                    ? `1/${Math.round(1 / extracted.ExposureTime)}s` 
                    : `${extracted.ExposureTime}s`
                : fallback.exposure || undefined,
            iso: extracted.ISO || fallback.iso || undefined,
            focalLength: extracted.FocalLength 
                ? `${Math.round(extracted.FocalLength)}mm` 
                : fallback.focalLength || undefined,
            whiteBalance: extracted.WhiteBalance !== undefined
                ? extracted.WhiteBalance === 0 ? "Auto" : "Manual"
                : fallback.whiteBalance || undefined,
            imageSize: imageSize,
            dateTimeOriginal: extracted.DateTimeOriginal || photo?.date || photo?.createdAt || undefined,
        };
    }, [extractedExif, photo]);

    // 構造化データ（JSON-LD）を生成（条件分岐の前に配置）
    const structuredData = useMemo(() => {
        if (!photo) return null;
        return generatePhotoStructuredData(photo, locale);
    }, [photo, locale]);

    // ローディング中
    if (loading) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="w-12 h-12 border-3 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            </main>
        );
    }

    // 写真が見つからない場合は404
    if (!photo) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                    <h1 className="text-3xl font-bold mb-4">
                        {locale === "en" ? "Photo Not Found" : "写真が見つかりません"}
                    </h1>
                    <p className="text-white/60 mb-6">
                        {locale === "en" 
                            ? "The photo you are looking for does not exist." 
                            : "お探しの写真は存在しません。"}
                    </p>
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
                        style={{ 
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                            minHeight: "44px"
                        }}
                    >
                        <ArrowLeftIcon className="w-4 h-4" />
                        <span>{locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}</span>
                    </Link>
                </div>
            </main>
        );
    }

    const titleText = getLocalized(photo.title, locale) || (typeof photo.title === "string" ? photo.title : "");
    const altText = getLocalized(photo.alt, locale) || titleText || "";
    const locationText = typeof photo.location === "string" ? photo.location : "";
    const paragraphs = getLocalizedParagraphs(photo.description, locale);

    const preferred = getPreferredMapLink(photo);
    const fallbackHref = photo.coords ? makeGoogleSearch(photo.coords.lat, photo.coords.lng) : undefined;
    const href = preferred?.href ?? fallbackHref;

    // 共有機能
    const currentUrl = typeof window !== "undefined" 
        ? `${window.location.origin}/photo/${photo.id}` 
        : `${siteConfig.url}/photo/${photo.id}`;
    const shareText = titleText || "Photo";

    const handleShare = (e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
        }
        shareUrl(currentUrl, shareText, paragraphs.join(" "));
    };

    const handleCopyLink = async (e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
        }
        try {
            await copyToClipboard(currentUrl);
            showToast(locale === "en" ? "Link copied!" : "リンクをコピーしました");
        } catch (err) {
            showToast(locale === "en" ? "Failed to copy link" : "リンクのコピーに失敗しました");
        }
    };

    // カテゴリ表示名の取得
    const categoryDisplayName = photo ? (labels.category?.names?.[photo.category ?? ""] ?? photo.category ?? "") : "";

    return (
        <>
            {structuredData && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
                />
            )}
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
            {/* ヘッダー */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-6">
                <div className="flex-1">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-2"
                        style={{ 
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                            minHeight: "44px"
                        }}
                    >
                        <ArrowLeftIcon className="w-4 h-4" />
                        <span className="text-sm">{locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}</span>
                    </Link>
                </div>
                <div className="flex-shrink-0">
                    <LocaleToggle
                        locale={locale}
                        setLocale={setLocale}
                        labels={labels.ui?.language ?? { ja: "日本語", en: "English" }}
                    />
                </div>
            </div>

            {/* 写真 */}
            <div className="mb-6 relative">
                <PhotoImage
                    src={photo.src}
                    alt={altText}
                    focalPoint={photo.focalPoint}
                    onExifLoaded={setExtractedExif}
                />
                
                {/* 前後の写真へのナビゲーション（モバイル - 写真の上にオーバーレイ） */}
                {(prevPhoto || nextPhoto) && (
                    <div className="flex items-center justify-between absolute bottom-4 left-4 right-4 sm:hidden z-10 pointer-events-none">
                        {prevPhoto ? (
                            <Link
                                href={`/photo/${prevPhoto.id}`}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-black/60 hover:bg-black/80 backdrop-blur-sm text-white rounded-md transition-colors pointer-events-auto"
                                style={{ 
                                    touchAction: "manipulation",
                                    WebkitTapHighlightColor: "transparent",
                                    minHeight: "44px"
                                }}
                            >
                                <ArrowLeftIcon className="w-4 h-4" />
                                <span className="text-sm">{locale === "en" ? "Previous" : "前へ"}</span>
                            </Link>
                        ) : (
                            <div />
                        )}
                        {nextPhoto ? (
                            <Link
                                href={`/photo/${nextPhoto.id}`}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-black/60 hover:bg-black/80 backdrop-blur-sm text-white rounded-md transition-colors pointer-events-auto"
                                style={{ 
                                    touchAction: "manipulation",
                                    WebkitTapHighlightColor: "transparent",
                                    minHeight: "44px"
                                }}
                            >
                                <span className="text-sm">{locale === "en" ? "Next" : "次へ"}</span>
                                <ArrowRightIcon className="w-4 h-4" />
                            </Link>
                        ) : (
                            <div />
                        )}
                    </div>
                )}
            </div>

            {/* 写真情報 */}
            <div className="space-y-4">
                {/* タイトルとカテゴリ */}
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold mb-2">{titleText}</h1>
                    {categoryDisplayName && (
                        <div className="text-sm text-white/60 mb-2">{categoryDisplayName}</div>
                    )}
                </div>

                {/* 説明 */}
                {paragraphs.length > 0 && (
                    <div className="text-sm sm:text-base text-white/80 leading-relaxed">
                        {paragraphs.map((line, i) => (
                            <p key={i} className={i === 0 ? "" : "mt-3"}>
                                {line}
                            </p>
                        ))}
                    </div>
                )}

                {/* 場所と地図リンク */}
                {locationText && (
                    <div>
                        <div className="text-sm text-white/60 mb-2">{locationText}</div>
                        {href && (
                            <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-sm text-white/60 underline hover:text-white/80 transition-colors"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" className="text-white/60">
                                    <path d="M12 2C8.686 2 6 4.686 6 8c0 5.25 6 12 6 12s6-6.75 6-12c0-3.314-2.686-6-6-6z" fill="currentColor" />
                                    <circle cx="12" cy="8" r="2.2" fill="black" />
                                </svg>
                                <span>{locale === "ja" ? "地図で見る" : "View on map"}</span>
                            </a>
                        )}
                    </div>
                )}

                {/* 撮影者とライセンス */}
                {(photo.photographer || photo.license) && (
                    <div className="text-sm text-white/50">
                        {photo.photographer && <span>{photo.photographer}</span>}
                        {photo.photographer && photo.license && <span className="mx-2">·</span>}
                        {photo.license && <span>{photo.license}</span>}
                    </div>
                )}

                {/* EXIF情報 */}
                {(mergedExif.camera || mergedExif.lens || mergedExif.aperture || mergedExif.exposure || mergedExif.iso || mergedExif.focalLength || mergedExif.whiteBalance || mergedExif.imageSize || mergedExif.dateTimeOriginal) && (
                    <div className="pt-4 border-t border-white/10">
                        <div className="text-sm font-medium text-white/70 mb-3">
                            {locale === "en" ? "Camera Settings" : "撮影情報"}
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm text-white/50">
                            {mergedExif.camera && (
                                <div>
                                    <span className="text-white/40">{locale === "en" ? "Camera" : "カメラ"}: </span>
                                    {mergedExif.camera}
                                </div>
                            )}
                            {mergedExif.lens && (
                                <div>
                                    <span className="text-white/40">{locale === "en" ? "Lens" : "レンズ"}: </span>
                                    {mergedExif.lens}
                                </div>
                            )}
                            {mergedExif.aperture && (
                                <div>
                                    <span className="text-white/40">{locale === "en" ? "Aperture" : "絞り"}: </span>
                                    {mergedExif.aperture}
                                </div>
                            )}
                            {mergedExif.exposure && (
                                <div>
                                    <span className="text-white/40">{locale === "en" ? "Exposure" : "シャッター速度"}: </span>
                                    {mergedExif.exposure}
                                </div>
                            )}
                            {mergedExif.iso && (
                                <div>
                                    <span className="text-white/40">ISO: </span>
                                    {mergedExif.iso}
                                </div>
                            )}
                            {mergedExif.focalLength && (
                                <div>
                                    <span className="text-white/40">{locale === "en" ? "Focal Length" : "焦点距離"}: </span>
                                    {mergedExif.focalLength}
                                </div>
                            )}
                            {mergedExif.whiteBalance && (
                                <div>
                                    <span className="text-white/40">{locale === "en" ? "White Balance" : "ホワイトバランス"}: </span>
                                    {mergedExif.whiteBalance}
                                </div>
                            )}
                            {mergedExif.imageSize && (
                                <div>
                                    <span className="text-white/40">{locale === "en" ? "Image Size" : "画像サイズ"}: </span>
                                    {mergedExif.imageSize}
                                </div>
                            )}
                            {mergedExif.dateTimeOriginal && (
                                <div className="col-span-2">
                                    <span className="text-white/40">{locale === "en" ? "Date Taken" : "撮影日時"}: </span>
                                    {new Date(mergedExif.dateTimeOriginal).toLocaleString(locale === "ja" ? "ja-JP" : "en-US", {
                                        year: "numeric",
                                        month: "long",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit"
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* アクションボタン */}
                <div className="pt-4 border-t border-white/10 space-y-4">
                    {/* お気に入りボタン */}
                    <button
                        onClick={() => toggleFavorite(photo.id)}
                        onTouchStart={(e) => {
                            e.stopPropagation();
                        }}
                        onTouchEnd={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            toggleFavorite(photo.id);
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
                        style={{ 
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                            minHeight: "44px"
                        }}
                    >
                        {isFav ? (
                            <>
                                <HeartIcon className="w-5 h-5 text-red-500" />
                                <span>{locale === "en" ? "Remove from Favorites" : "お気に入りから削除"}</span>
                            </>
                        ) : (
                            <>
                                <HeartIconOutline className="w-5 h-5" />
                                <span>{locale === "en" ? "Add to Favorites" : "お気に入りに追加"}</span>
                            </>
                        )}
                    </button>

                    {/* 共有機能 */}
                    <div>
                        <div className="text-sm font-medium text-white/70 mb-2">
                            {locale === "en" ? "Share" : "共有"}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={handleShare}
                                onTouchStart={(e) => {
                                    e.stopPropagation();
                                }}
                                onTouchEnd={(e) => {
                                    e.stopPropagation();
                                    handleShare();
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white/5 hover:bg-white/10 text-white/80 rounded-md transition-colors"
                                style={{ 
                                    touchAction: "manipulation",
                                    WebkitTapHighlightColor: "transparent",
                                    minHeight: "44px"
                                }}
                            >
                                <ShareIcon className="w-4 h-4" />
                                <span>{locale === "en" ? "Share" : "共有"}</span>
                            </button>
                            <button
                                onClick={handleCopyLink}
                                onTouchStart={(e) => {
                                    e.stopPropagation();
                                }}
                                onTouchEnd={(e) => {
                                    e.stopPropagation();
                                    handleCopyLink();
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white/5 hover:bg-white/10 text-white/80 rounded-md transition-colors"
                                style={{ 
                                    touchAction: "manipulation",
                                    WebkitTapHighlightColor: "transparent",
                                    minHeight: "44px"
                                }}
                            >
                                <LinkIcon className="w-4 h-4" />
                                <span>{locale === "en" ? "Copy Link" : "リンクをコピー"}</span>
                            </button>
                            <button
                                onClick={() => shareToTwitter(currentUrl, shareText)}
                                onTouchStart={(e) => {
                                    e.stopPropagation();
                                }}
                                onTouchEnd={(e) => {
                                    e.stopPropagation();
                                    shareToTwitter(currentUrl, shareText);
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white/5 hover:bg-white/10 text-white/80 rounded-md transition-colors"
                                style={{ 
                                    touchAction: "manipulation",
                                    WebkitTapHighlightColor: "transparent",
                                    minHeight: "44px"
                                }}
                            >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                </svg>
                                <span>Twitter</span>
                            </button>
                            <button
                                onClick={() => shareToFacebook(currentUrl)}
                                onTouchStart={(e) => {
                                    e.stopPropagation();
                                }}
                                onTouchEnd={(e) => {
                                    e.stopPropagation();
                                    shareToFacebook(currentUrl);
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white/5 hover:bg-white/10 text-white/80 rounded-md transition-colors"
                                style={{ 
                                    touchAction: "manipulation",
                                    WebkitTapHighlightColor: "transparent",
                                    minHeight: "44px"
                                }}
                            >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                                </svg>
                                <span>Facebook</span>
                            </button>
                            {locale === "ja" && (
                                <button
                                    onClick={() => shareToLine(currentUrl, shareText)}
                                    onTouchStart={(e) => {
                                        e.stopPropagation();
                                    }}
                                    onTouchEnd={(e) => {
                                        e.stopPropagation();
                                        shareToLine(currentUrl, shareText);
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white/5 hover:bg-white/10 text-white/80 rounded-md transition-colors"
                                    style={{ 
                                        touchAction: "manipulation",
                                        WebkitTapHighlightColor: "transparent",
                                        minHeight: "44px"
                                    }}
                                >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.63.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.086.766.063 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                                    </svg>
                                    <span>LINE</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* 前後の写真へのナビゲーション（デスクトップ） */}
                {(prevPhoto || nextPhoto) && (
                    <div className="pt-4 border-t border-white/10 hidden sm:flex items-center justify-between">
                        {prevPhoto ? (
                            <Link
                                href={`/photo/${prevPhoto.id}`}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
                                style={{ 
                                    touchAction: "manipulation",
                                    WebkitTapHighlightColor: "transparent",
                                    minHeight: "44px"
                                }}
                            >
                                <ArrowLeftIcon className="w-5 h-5" />
                                <div className="text-left">
                                    <div className="text-xs text-white/60">{locale === "en" ? "Previous" : "前へ"}</div>
                                    <div className="text-sm font-medium">{getLocalized(prevPhoto.title, locale) || prevPhoto.id}</div>
                                </div>
                            </Link>
                        ) : (
                            <div />
                        )}
                        {nextPhoto ? (
                            <Link
                                href={`/photo/${nextPhoto.id}`}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
                                style={{ 
                                    touchAction: "manipulation",
                                    WebkitTapHighlightColor: "transparent",
                                    minHeight: "44px"
                                }}
                            >
                                <div className="text-right">
                                    <div className="text-xs text-white/60">{locale === "en" ? "Next" : "次へ"}</div>
                                    <div className="text-sm font-medium">{getLocalized(nextPhoto.title, locale) || nextPhoto.id}</div>
                                </div>
                                <ArrowRightIcon className="w-5 h-5" />
                            </Link>
                        ) : (
                            <div />
                        )}
                    </div>
                    )}
                </div>
            </main>
        </>
    );
}
