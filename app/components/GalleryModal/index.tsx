"use client";
import React, { useEffect, useRef, useState } from "react";
import type { Photo, Locale } from "../../data/photos";
import { getLocalized, getLocalizedParagraphs, getPreferredMapLink, makeGoogleSearch } from "../../data/photos";
import { useSwipe } from "../../../lib/hooks/useSwipe";
import { useFavorites } from "../../../lib/hooks/useFavorites";
import { useViewHistory } from "../../../lib/hooks/useViewHistory";
import { useToast } from "../../../lib/hooks/useToast";
import { useImagePreloader } from "../../../lib/hooks/useImagePreloader";
import { copyToClipboard, shareUrl } from "../../../lib/utils/share";
import { siteConfig } from "../../../lib/utils/seo";
import { ROUTES } from "../../../lib/routes";
import { log } from "../../../lib/utils/log";
import { lockBodyScroll, unlockBodyScroll } from "./scrollLock";
import ModalImage from "./ModalImage";
import ModalControls from "./ModalControls";
import ModalCaption from "./ModalCaption";
import ModalKeyboardHelp from "./ModalKeyboardHelp";

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
    photos, currentIndex, onClose, onNext, onPrev, locale,
    categoryDisplayMap = {},
    mapLabel = { ja: "地図で見る", en: "View on map" },
}: Props) {
    const p = photos[currentIndex];

    // --- All hooks must be called unconditionally before any early return ---

    const modalRef = useRef<HTMLDivElement | null>(null);
    const firstFocusableRef = useRef<HTMLButtonElement | null>(null);
    const lastFocusableRef = useRef<HTMLButtonElement | null>(null);
    const prevActiveElementRef = useRef<HTMLElement | null>(null);
    const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [helpOpen, setHelpOpen] = useState(false);
    const helpOpenRef = useRef(false);
    useEffect(() => { helpOpenRef.current = helpOpen; }, [helpOpen]);

    const currentPhotoIdRef = useRef(p?.id ?? "");
    useEffect(() => { currentPhotoIdRef.current = p?.id ?? ""; }, [p?.id]);

    const { handlers: swipeHandlers } = useSwipe({
        onSwipeLeft: onNext, onSwipeRight: onPrev, onSwipeDown: onClose,
        threshold: 50, velocityThreshold: 0.3,
    });
    const { isFavorite, toggleFavorite } = useFavorites();
    const { addToHistory } = useViewHistory();
    const { showToast } = useToast();
    const { preload } = useImagePreloader();

    useEffect(() => { if (p?.id) addToHistory(p.id); }, [p?.id, addToHistory]);

    // 前後の画像をプリロード
    useEffect(() => {
        if (!p?.src) return;
        preload(p.src);
        if (photos.length < 2) return;
        const nextIdx = (currentIndex + 1) % photos.length;
        const prevIdx = (currentIndex - 1 + photos.length) % photos.length;
        if (photos[nextIdx]?.src) preload(photos[nextIdx].src);
        if (photos[prevIdx]?.src) preload(photos[prevIdx].src);
    }, [currentIndex, photos, p?.src, preload]);

    // フォーカストラップ + キーボード操作 + body scroll lock
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") { e.preventDefault(); onNext(); return; }
            if (e.key === "ArrowLeft")  { e.preventDefault(); onPrev(); return; }
            if (e.key === "Escape") {
                e.preventDefault();
                if (helpOpenRef.current) { setHelpOpen(false); return; }
                onClose();
                return;
            }
            if (e.key === "?") { e.preventDefault(); setHelpOpen((v) => !v); return; }
            if (e.key === "h" || e.key === "H") { e.preventDefault(); toggleFavorite(currentPhotoIdRef.current); return; }
            if (e.key === "Tab") {
                const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (!focusable || focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey) {
                    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
                } else {
                    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
                }
            }
        };

        lockBodyScroll();
        prevActiveElementRef.current = (document.activeElement as HTMLElement) ?? null;
        window.addEventListener("keydown", onKey);
        focusTimerRef.current = setTimeout(() => { firstFocusableRef.current?.focus(); }, 100);

        return () => {
            if (focusTimerRef.current !== null) clearTimeout(focusTimerRef.current);
            window.removeEventListener("keydown", onKey);
            unlockBodyScroll();
            try {
                const el = prevActiveElementRef.current;
                if (el && typeof el.focus === "function") el.focus();
                else (document.activeElement as HTMLElement | null)?.blur?.();
            } catch { /* noop */ }
            prevActiveElementRef.current = null;
        };
    }, [onClose, onNext, onPrev, toggleFavorite]);

    // --- Now safe to do the null guard ---
    if (!p) return null;

    const titleText = getLocalized(p.title, locale) || (typeof p.title === "string" ? p.title : "");
    const altText = getLocalized(p.alt, locale) || titleText || "";
    const locationText = typeof p.location === "string" ? p.location : "";
    const mapText = locale === "ja" ? mapLabel.ja : mapLabel.en;
    const paragraphs = getLocalizedParagraphs(p.description, locale);
    const preferred = getPreferredMapLink(p);
    const mapHref = preferred?.href ?? (p.coords ? makeGoogleSearch(p.coords.lat, p.coords.lng) : undefined);

    const currentUrl = typeof window !== "undefined"
        ? `${window.location.origin}${ROUTES.PHOTO(p.id)}`
        : `${siteConfig.url}${ROUTES.PHOTO(p.id)}`;
    const shareText = titleText || "Photo";

    const handleShare = async () => {
        const usedClipboard = await shareUrl(currentUrl, shareText, paragraphs.join(" "));
        if (usedClipboard) showToast(locale === "en" ? "Link copied to clipboard!" : "リンクをクリップボードにコピーしました", "success");
    };

    const handleCopyLink = async () => {
        try {
            await copyToClipboard(currentUrl);
            showToast(locale === "en" ? "Link copied to clipboard!" : "リンクをクリップボードにコピーしました", "success");
        } catch (error) {
            log.error("Failed to copy:", error);
            showToast(locale === "en" ? "Failed to copy link" : "リンクのコピーに失敗しました", "error");
        }
    };

    const handleOverlayClick = () => {
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
                {/* 画像エリア */}
                <div
                    className="relative w-full flex-shrink-0 bg-black sm:bg-transparent"
                    style={{ height: "60vh", minHeight: "300px", fontSize: 0, lineHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                    <div className="relative w-full h-full" {...swipeHandlers}>
                        <ModalImage key={p.id} src={p.src} alt={altText} focalPoint={p.focalPoint} />
                    </div>

                    <ModalControls
                        onPrev={onPrev}
                        onNext={onNext}
                        onClose={onClose}
                        isFav={isFavorite(p.id)}
                        onToggleFavorite={() => toggleFavorite(p.id)}
                        firstFocusableRef={firstFocusableRef}
                        lastFocusableRef={lastFocusableRef}
                    />
                </div>

                {/* キャプションエリア */}
                <ModalCaption
                    photo={p}
                    locale={locale}
                    titleText={titleText}
                    paragraphs={paragraphs}
                    locationText={locationText}
                    mapHref={mapHref}
                    mapText={mapText}
                    categoryDisplayMap={categoryDisplayMap}
                    currentUrl={currentUrl}
                    shareText={shareText}
                    onShare={handleShare}
                    onCopyLink={handleCopyLink}
                />
            </div>

            {helpOpen && (
                <ModalKeyboardHelp locale={locale} onClose={() => setHelpOpen(false)} />
            )}
        </div>
    );
}
