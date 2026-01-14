"use client";
import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import type { Photo, Locale } from "../data/photos";
import { getLocalized, getLocalizedParagraphs, getPreferredMapLink, makeGoogleSearch } from "../data/photos";

// モーダル用画像コンポーネント（エラーハンドリング付き）
function ModalImage({ src, alt, focalPoint }: { src: string; alt: string; focalPoint?: { x: number; y: number } }) {
    const [imageError, setImageError] = useState(false);

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
            onError={() => setImageError(true)}
        />
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

    // 画像のプリロード
    useEffect(() => {
        const preloadImages = () => {
            const nextIndex = (currentIndex + 1) % photos.length;
            const prevIndex = (currentIndex - 1 + photos.length) % photos.length;

            const nextImg = new window.Image();
            nextImg.src = photos[nextIndex]?.src || "";
            const prevImg = new window.Image();
            prevImg.src = photos[prevIndex]?.src || "";
        };

        preloadImages();
    }, [currentIndex, photos]);

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
                        maxHeight: "calc(100vh - 60vh - 20px)",
                        minHeight: "120px",
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
                </div>
            </div>
        </div>
    );
}
