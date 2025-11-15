"use client";
import React, { useEffect, useRef } from "react";
import Image from "next/image";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import type { Photo, Locale } from "../data/photos";
import { getLocalized, getLocalizedParagraphs, getPreferredMapLink, makeGoogleSearch } from "../data/photos";

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
    const titleText = getLocalized(p.title as any, locale) || (typeof p.title === "string" ? p.title : "");
    const altText = getLocalized(p.alt as any, locale) || titleText || "";
    const locationText = typeof p.location === "string" ? p.location : "";
    const mapText = locale === "ja" ? mapLabel.ja : mapLabel.en;

    const paragraphs = getLocalizedParagraphs(p.description as any, locale);

    const preferred = getPreferredMapLink(p);
    const fallbackHref = p.coords ? makeGoogleSearch(p.coords.lat, p.coords.lng) : undefined;
    const href = preferred?.href ?? fallbackHref;

    const prevActiveElementRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") onNext();
            if (e.key === "ArrowLeft") onPrev();
            if (e.key === "Escape") onClose();
        };

        lockBodyScroll();
        prevActiveElementRef.current = (document.activeElement as HTMLElement) ?? null;
        window.addEventListener("keydown", onKey);

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
    }, [onClose, onNext, onPrev]);

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
            role="dialog"
            aria-modal="true"
            aria-label={titleText || "Photo"}
            onClick={handleOverlayClick}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.9)", padding: 12 }}
        >
            <div onClick={(e) => e.stopPropagation()} className="relative mx-4 w-full" style={{ maxWidth: 980 }}>
                <div className="relative w-full overflow-hidden bg-black" style={{ paddingTop: "66.66%", fontSize: 0, lineHeight: 0 }}>
                    <Image
                        src={p.src}
                        alt={altText}
                        fill
                        className="object-contain block"
                        sizes="90vw"
                        priority
                        style={p.focalPoint ? { objectPosition: `${p.focalPoint.x * 100}% ${p.focalPoint.y * 100}%` } : undefined}
                    />

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onPrev();
                        }}
                        aria-label="Previous"
                        className="absolute left-3 top-1/2 transform -translate-y-1/2 p-3 rounded-full bg-white/6 hover:bg-white/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shadow-lg"
                        style={{ backdropFilter: "blur(4px)" }}
                    >
                        <ArrowLeftIcon className="w-5 h-5 text-white" />
                    </button>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onNext();
                        }}
                        aria-label="Next"
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 p-3 rounded-full bg-white/6 hover:bg-white/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shadow-lg"
                        style={{ backdropFilter: "blur(4px)" }}
                    >
                        <ArrowRightIcon className="w-5 h-5 text-white" />
                    </button>
                </div>

                <div className="mt-3 text-white/90">
                    <div className="text-lg font-medium">{titleText}</div>

                    <div className="text-sm text-white/60">{categoryDisplayMap[p.category ?? ""] ?? (p.category ?? "")}</div>

                    {paragraphs.length > 0 ? (
                        <div className="mt-1 text-sm text-white/70" role="note">
                            {paragraphs.map((line, i) => (
                                <p key={i} className={i === 0 ? "" : "mt-1"}>
                                    {line}
                                </p>
                            ))}
                        </div>
                    ) : null}

                    {locationText ? (
                        <div className="mt-2">
                            <div className="text-sm text-white/50 truncate" title={locationText}>
                                {locationText}
                            </div>

                            {href ? (
                                <div className="mt-1.5">
                                    <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 text-sm text-white/50 underline"
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

                    <div className="mt-2 text-xs text-white/50">
                        {p.photographer ? <span>{p.photographer}</span> : null}
                        {p.photographer && p.license ? <span className="mx-2">·</span> : null}
                        {p.license ? <span>{p.license}</span> : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
