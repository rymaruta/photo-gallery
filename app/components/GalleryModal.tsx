"use client";
import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import type { Photo, Locale } from "../data/photos";
import { getLocalized, getLocalizedParagraphs, getPreferredMapLink, makeGoogleSearch } from "../data/photos";
import { useSwipe } from "../../lib/hooks/useSwipe";
import { useFavorites } from "../../lib/hooks/useFavorites";
import { useViewHistory } from "../../lib/hooks/useViewHistory";
import { useToast } from "../../lib/hooks/useToast";
import { useImagePreloader } from "../../lib/hooks/useImagePreloader";
import { HeartIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartIconOutline } from "@heroicons/react/24/outline";
import { ShareIcon, LinkIcon } from "@heroicons/react/24/outline";
import { shareUrl, copyToClipboard, shareToTwitter, shareToFacebook, shareToLine } from "../../lib/utils/share";
import { siteConfig } from "../../lib/utils/seo";

// モーダル用画像コンポーネント（エラーハンドリング付き）
function ModalImage({ src, alt, focalPoint }: { src: string; alt: string; focalPoint?: { x: number; y: number } }) {
    const [imageError, setImageError] = useState(false);
    const [imageLoading, setImageLoading] = useState(true);

    if (imageError) {
        return (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
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
        <>
            {imageLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
                    <div className="w-12 h-12 border-3 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            )}
            <Image
                src={src}
                alt={alt}
                fill
                className="object-contain"
                sizes="(max-width: 640px) 100vw, 90vw"
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
        </>
    );
}

// Module-scope lock state to avoid per-instance races
let _openModalCount = 0;
let _prevBodyOverflow: string | null = null;
let _prevHtmlOverflow: string | null = null;
let _prevBodyPositionStyle: string | null = null;
let _prevBodyTop: string | null = null;
let _prevScrollY = 0;

function lockBodyScroll() {
    if (_openModalCount === 0) {
        _prevBodyOverflow = document.body.style.overflow ?? "";
        _prevHtmlOverflow = document.documentElement.style.overflow ?? "";
        _prevBodyPositionStyle = document.body.style.position ?? "";
        _prevBodyTop = document.body.style.top ?? "";
        _prevScrollY = window.scrollY || window.pageYOffset || 0;

        // simplest: hide overflow on body + html
        document.body.style.overflow = "hidden";
        document.documentElement.style.overflow = "hidden";

        // alternative robust approach (prevent layout shift):
        // document.body.style.position = "fixed";
        // document.body.style.top = `-${_prevScrollY}px`;
        // document.body.style.left = "0";
        // document.body.style.right = "0";
    }
    _openModalCount += 1;
}

function unlockBodyScroll() {
    _openModalCount = Math.max(0, _openModalCount - 1);
    if (_openModalCount === 0) {
        document.body.style.overflow = _prevBodyOverflow ?? "";
        document.documentElement.style.overflow = _prevHtmlOverflow ?? "";

        if (_prevBodyPositionStyle === "fixed") {
            document.body.style.position = _prevBodyPositionStyle ?? "";
            document.body.style.top = _prevBodyTop ?? "";
            window.scrollTo(0, _prevScrollY);
        } else {
            document.body.style.position = _prevBodyPositionStyle ?? "";
            document.body.style.top = _prevBodyTop ?? "";
        }

        _prevBodyOverflow = null;
        _prevHtmlOverflow = null;
        _prevBodyPositionStyle = null;
        _prevBodyTop = null;
        _prevScrollY = 0;

        // Force-clear fallback (race protection)
        if (getComputedStyle(document.body).overflow === "hidden") {
            document.body.style.overflow = "";
            document.documentElement.style.overflow = "";
            setTimeout(() => {
                document.body.style.overflow = "";
                document.documentElement.style.overflow = "";
            }, 50);
        }
    }
}

type Props = {
    photos: Photo[];
    currentIndex: number;
    onClose: () => void;
    onNext: () => void;
    onPrev: () => void;
    locale: Locale;
    categoryDisplayMap?: Record<string, string>;
    mapLabel?: { ja: string; en: string };
};

export default function GalleryModal({
    photos,
    currentIndex,
    onClose,
    onNext,
    onPrev,
    locale,
    categoryDisplayMap = {},
    mapLabel = { ja: "地図で見る", en: "View on map" },
}: Props) {
    const p = photos[currentIndex];
    const titleText = getLocalized(p.title, locale) || (typeof p.title === "string" ? p.title : "");
    const altText = getLocalized(p.alt, locale) || titleText || "";
    const locationText = typeof p.location === "string" ? p.location : "";
    const mapText = locale === "ja" ? mapLabel.ja : mapLabel.en;

    const paragraphs = getLocalizedParagraphs(p.description, locale);

    const preferred = getPreferredMapLink(p);
    const fallbackHref = p.coords ? makeGoogleSearch(p.coords.lat, p.coords.lng) : undefined;
    const href = preferred?.href ?? fallbackHref;

    const prevActiveElementRef = useRef<HTMLElement | null>(null);
    const modalRef = useRef<HTMLDivElement | null>(null);
    const firstFocusableRef = useRef<HTMLButtonElement | null>(null);
    const lastFocusableRef = useRef<HTMLButtonElement | null>(null);

    // スワイプジェスチャー
    const { swipeDirection, handlers: swipeHandlers } = useSwipe({
        onSwipeLeft: onNext,
        onSwipeRight: onPrev,
        threshold: 50,
        velocityThreshold: 0.3,
    });

    // お気に入り機能
    const { isFavorite, toggleFavorite } = useFavorites();
    const isFav = isFavorite(p.id);

    // 閲覧履歴機能
    const { addToHistory } = useViewHistory();

    // トースト通知
    const { showToast } = useToast();

    // 画像プリロード
    const { preload } = useImagePreloader();

    // 画像が表示されたときに閲覧履歴に追加
    useEffect(() => {
        if (p?.id) {
            addToHistory(p.id);
        }
    }, [p?.id, addToHistory]);

    // 共有機能（個別ページのURLを使用）
    const currentUrl = typeof window !== "undefined" 
        ? `${window.location.origin}/photo/${p.id}` 
        : `${siteConfig.url}/photo/${p.id}`;
    const shareText = titleText || "Photo";

    const handleShare = (e: React.MouseEvent) => {
        e.stopPropagation();
        shareUrl(currentUrl, shareText, paragraphs.join(" "));
    };

    const handleCopyLink = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await copyToClipboard(currentUrl);
            showToast(
                locale === "en" ? "Link copied to clipboard!" : "リンクをクリップボードにコピーしました",
                "success"
            );
        } catch (error) {
            console.error("Failed to copy:", error);
            showToast(
                locale === "en" ? "Failed to copy link" : "リンクのコピーに失敗しました",
                "error"
            );
        }
    };

    // 画像のプリロード（前後の画像を積極的にプリロード）
    useEffect(() => {
        if (!p?.src) return;

        // 現在の画像を確実にプリロード
        preload(p.src);

        // 前後の画像もプリロード
        const nextIndex = (currentIndex + 1) % photos.length;
        const prevIndex = (currentIndex - 1 + photos.length) % photos.length;

        if (photos[nextIndex]?.src) {
            preload(photos[nextIndex].src);
        }
        if (photos[prevIndex]?.src) {
            preload(photos[prevIndex].src);
        }

        // さらに先の画像もプリロード（2枚先まで）
        const nextNextIndex = (currentIndex + 2) % photos.length;
        const prevPrevIndex = (currentIndex - 2 + photos.length) % photos.length;

        if (photos[nextNextIndex]?.src) {
            preload(photos[nextNextIndex].src);
        }
        if (photos[prevPrevIndex]?.src) {
            preload(photos[prevPrevIndex].src);
        }
    }, [currentIndex, photos, p?.src, preload]);

    // フォーカストラップとキーボード操作
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") {
                e.preventDefault();
                onNext();
            }
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                onPrev();
            }
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
            // Tab キーでフォーカストラップ
            if (e.key === "Tab") {
                const focusableElements = modalRef.current?.querySelectorAll<HTMLElement>(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (!focusableElements || focusableElements.length === 0) return;

                const firstElement = focusableElements[0];
                const lastElement = focusableElements[focusableElements.length - 1];

                if (e.shiftKey) {
                    // Shift + Tab
                    if (document.activeElement === firstElement) {
                        e.preventDefault();
                        lastElement.focus();
                    }
                } else {
                    // Tab
                    if (document.activeElement === lastElement) {
                        e.preventDefault();
                        firstElement.focus();
                    }
                }
            }
        };

        lockBodyScroll();
        prevActiveElementRef.current = (document.activeElement as HTMLElement) ?? null;
        window.addEventListener("keydown", onKey);

        // モーダルが開いたら最初のフォーカス可能要素にフォーカス
        setTimeout(() => {
            firstFocusableRef.current?.focus();
        }, 100);

        return () => {
            window.removeEventListener("keydown", onKey);
            unlockBodyScroll();
            try {
                const el = prevActiveElementRef.current;
                if (el && typeof el.focus === "function") el.focus();
                else (document.activeElement as HTMLElement | null)?.blur?.();
            } catch {
                // noop
            }
            prevActiveElementRef.current = null;
        };
    }, [onClose, onNext, onPrev, currentIndex]);

    // Ensure overlay click explicitly unlocks before closing to avoid timing races
    const handleOverlayClick = (e: React.MouseEvent) => {
        try {
            unlockBodyScroll();
        } catch {
            // noop
        }
        onClose();
    };

    return (
        <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={titleText || "Photo"}
            onClick={handleOverlayClick}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.9)", padding: "0" }}
        >
            <div 
                onClick={(e) => e.stopPropagation()} 
                className="relative w-full h-full sm:h-auto sm:max-h-[95vh] flex flex-col sm:mx-4 sm:rounded-lg overflow-hidden bg-black"
                style={{ maxWidth: "980px" }}
            >
                {/* 画像エリア - スマホでは高さを確保、PCではアスペクト比を維持 */}
                <div 
                    className="relative w-full flex-shrink-0 bg-black sm:bg-transparent"
                    style={{ 
                        height: "60vh",
                        minHeight: "300px",
                        fontSize: 0, 
                        lineHeight: 0,
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}
                    {...swipeHandlers}
                >
                    {/* 画像コンテナ - 全画面で表示、object-containで全体を表示 */}
                    <div 
                        className="relative w-full h-full"
                        style={{
                            maxWidth: "100%",
                            maxHeight: "100%"
                        }}
                    >
                        <ModalImage
                            src={p.src}
                            alt={altText}
                            focalPoint={p.focalPoint}
                        />
                    </div>

                    {/* 前へボタン - スマホでは小さく、PCでは大きく */}
                    <button
                        ref={firstFocusableRef}
                        onClick={(e) => {
                            e.stopPropagation();
                            onPrev();
                        }}
                        aria-label="Previous"
                        className="absolute left-2 sm:left-3 top-1/2 transform -translate-y-1/2 p-2 sm:p-3 rounded-full bg-white/6 hover:bg-white/12 active:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shadow-lg transition-colors"
                        style={{ backdropFilter: "blur(4px)" }}
                    >
                        <ArrowLeftIcon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                    </button>

                    {/* 次へボタン - スマホでは小さく、PCでは大きく */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onNext();
                        }}
                        aria-label="Next"
                        className="absolute right-2 sm:right-3 top-1/2 transform -translate-y-1/2 p-2 sm:p-3 rounded-full bg-white/6 hover:bg-white/12 active:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shadow-lg transition-colors"
                        style={{ backdropFilter: "blur(4px)" }}
                    >
                        <ArrowRightIcon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                    </button>

                    {/* お気に入りボタン - 右上 */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(p.id);
                        }}
                        aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                        className="absolute top-2 sm:top-3 right-12 sm:right-16 p-2 sm:p-3 rounded-full bg-white/6 hover:bg-white/12 active:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shadow-lg transition-colors z-10"
                        style={{ backdropFilter: "blur(4px)" }}
                    >
                        {isFav ? (
                            <HeartIcon className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" />
                        ) : (
                            <HeartIconOutline className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                        )}
                    </button>

                    {/* 閉じるボタン - 右上 */}
                    <button
                        ref={lastFocusableRef}
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                        aria-label="Close"
                        className="absolute top-2 sm:top-3 right-2 sm:right-3 p-2 sm:p-3 rounded-full bg-white/6 hover:bg-white/12 active:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shadow-lg transition-colors z-10"
                        style={{ backdropFilter: "blur(4px)" }}
                    >
                        <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* キャプションエリア - スクロール可能 */}
                <div 
                    className="flex-shrink-0 overflow-y-auto bg-black text-white/90 px-4 sm:px-6 py-3 sm:py-4"
                    style={{
                        maxHeight: "calc(100vh - 60vh - 40px)",
                        minHeight: "200px",
                        WebkitOverflowScrolling: "touch"
                    }}
                >
                    <div className="text-base sm:text-lg font-medium mb-1">{titleText}</div>

                    <div className="text-xs sm:text-sm text-white/60 mb-2">{categoryDisplayMap[p.category ?? ""] ?? (p.category ?? "")}</div>

                    {paragraphs.length > 0 ? (
                        <div className="mt-2 text-xs sm:text-sm text-white/70" role="note">
                            {paragraphs.map((line, i) => (
                                <p key={i} className={i === 0 ? "" : "mt-2"}>
                                    {line}
                                </p>
                            ))}
                        </div>
                    ) : null}

                    {locationText ? (
                        <div className="mt-3">
                            <div className="text-xs sm:text-sm text-white/50 truncate" title={locationText}>
                                {locationText}
                            </div>

                            {href ? (
                                <div className="mt-2">
                                    <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 text-xs sm:text-sm text-white/50 underline hover:text-white/70 transition-colors"
                                        onClick={(e) => e.stopPropagation()}
                                        aria-label={mapText}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" className="text-white/60">
                                            <path d="M12 2C8.686 2 6 4.686 6 8c0 5.25 6 12 6 12s6-6.75 6-12c0-3.314-2.686-6-6-6z" fill="currentColor" />
                                            <circle cx="12" cy="8" r="2.2" fill="black" />
                                        </svg>

                                        <span>{mapText}</span>
                                    </a>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="mt-3 text-xs text-white/50">
                        {p.photographer ? <span>{p.photographer}</span> : null}
                        {p.photographer && p.license ? <span className="mx-2">·</span> : null}
                        {p.license ? <span>{p.license}</span> : null}
                    </div>

                    {/* EXIF情報の表示 */}
                    {p.exif && (
                        <div className="mt-4 pt-4 border-t border-white/10">
                            <div className="text-xs font-medium text-white/70 mb-2">
                                {locale === "en" ? "Camera Settings" : "撮影情報"}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs text-white/50">
                                {p.exif.camera && (
                                    <div>
                                        <span className="text-white/40">{locale === "en" ? "Camera" : "カメラ"}: </span>
                                        {p.exif.camera}
                                    </div>
                                )}
                                {p.exif.lens && (
                                    <div>
                                        <span className="text-white/40">{locale === "en" ? "Lens" : "レンズ"}: </span>
                                        {p.exif.lens}
                                    </div>
                                )}
                                {p.exif.aperture && (
                                    <div>
                                        <span className="text-white/40">{locale === "en" ? "Aperture" : "絞り"}: </span>
                                        {p.exif.aperture}
                                    </div>
                                )}
                                {p.exif.exposure && (
                                    <div>
                                        <span className="text-white/40">{locale === "en" ? "Exposure" : "シャッター速度"}: </span>
                                        {p.exif.exposure}
                                    </div>
                                )}
                                {p.exif.iso && (
                                    <div>
                                        <span className="text-white/40">ISO: </span>
                                        {p.exif.iso}
                                    </div>
                                )}
                                {p.exif.focalLength && (
                                    <div>
                                        <span className="text-white/40">{locale === "en" ? "Focal Length" : "焦点距離"}: </span>
                                        {p.exif.focalLength}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 個別ページへのリンク */}
                    <div className="mt-4 pt-4 border-t border-white/10">
                        <Link
                            href={`/photo/${p.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
                        >
                            <span>{locale === "en" ? "View Full Page" : "個別ページを見る"}</span>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </Link>
                    </div>

                    {/* 共有機能 */}
                    <div className="mt-4 pt-4 border-t border-white/10 pb-4">
                        <div className="text-xs font-medium text-white/70 mb-2">
                            {locale === "en" ? "Share" : "共有"}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={handleShare}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-white/80 rounded-md transition-colors"
                                aria-label={locale === "en" ? "Share" : "共有"}
                            >
                                <ShareIcon className="w-4 h-4" />
                                <span>{locale === "en" ? "Share" : "共有"}</span>
                            </button>
                            <button
                                onClick={handleCopyLink}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-white/80 rounded-md transition-colors"
                                aria-label={locale === "en" ? "Copy link" : "リンクをコピー"}
                            >
                                <LinkIcon className="w-4 h-4" />
                                <span>{locale === "en" ? "Copy Link" : "リンクをコピー"}</span>
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    shareToTwitter(currentUrl, shareText);
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-white/80 rounded-md transition-colors"
                                aria-label="Share on Twitter"
                            >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                </svg>
                                <span>Twitter</span>
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    shareToFacebook(currentUrl);
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-white/80 rounded-md transition-colors"
                                aria-label="Share on Facebook"
                            >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                                </svg>
                                <span>Facebook</span>
                            </button>
                            {locale === "ja" && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        shareToLine(currentUrl, shareText);
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-white/80 rounded-md transition-colors"
                                    aria-label="Share on LINE"
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
            </div>
        </div>
    );
}
