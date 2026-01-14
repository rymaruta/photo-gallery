"use client";

import React, { useCallback } from "react";

type LocaleLabels = { ja?: string; en?: string };

type Props = {
    locale: "ja" | "en";
    setLocale: (l: "ja" | "en") => void;
    labels: LocaleLabels;
    wrapperWidth?: string; // e.g. "w-[120px] sm:w-[140px] md:w-[160px]"
    className?: string;
};

export default function LocaleToggle({
    locale,
    setLocale,
    labels,
    wrapperWidth = "w-[120px] sm:w-[140px] md:w-[160px]",
    className = "",
}: Props) {
    const onSetJa = useCallback(() => setLocale("ja"), [setLocale]);
    const onSetEn = useCallback(() => setLocale("en"), [setLocale]);

    const jaLabel = labels.ja ?? "日本語";
    const enLabel = labels.en ?? "English";

    return (
        <div className={`flex items-center gap-2 ${wrapperWidth} ${className}`}>
            <div className="rounded-lg bg-white/5 px-1 py-0.5 flex items-center gap-1 w-full justify-end">
                <button
                    type="button"
                    onClick={onSetJa}
                    onTouchStart={(e) => {
                        e.stopPropagation();
                    }}
                    onTouchEnd={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onSetJa();
                    }}
                    aria-pressed={locale === "ja"}
                    className={`rounded whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-white transition-colors
            px-2 py-1 text-[12px] sm:text-sm ${locale === "ja" ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                    aria-label={jaLabel}
                    style={{ 
                        touchAction: "manipulation",
                        WebkitTapHighlightColor: "transparent",
                        minHeight: "44px"
                    }}
                >
                    {jaLabel}
                </button>

                <button
                    type="button"
                    onClick={onSetEn}
                    onTouchStart={(e) => {
                        e.stopPropagation();
                    }}
                    onTouchEnd={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onSetEn();
                    }}
                    aria-pressed={locale === "en"}
                    className={`rounded whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-white transition-colors
            px-2 py-1 text-[12px] sm:text-sm ${locale === "en" ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                    aria-label={enLabel}
                    style={{ 
                        touchAction: "manipulation",
                        WebkitTapHighlightColor: "transparent",
                        minHeight: "44px"
                    }}
                >
                    {enLabel}
                </button>
            </div>
        </div>
    );
}
