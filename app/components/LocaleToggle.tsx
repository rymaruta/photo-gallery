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
            <div className="rounded-lg bg-white/5 px-0.5 py-0.5 flex items-center gap-0.5 w-full justify-end">
                <button
                    type="button"
                    onClick={onSetJa}
                    aria-pressed={locale === "ja"}
                    className={`rounded-md whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-white/30 transition-colors font-normal
            px-2.5 py-0.5 text-xs min-h-[44px] flex items-center justify-center ${locale === "ja" ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                    aria-label={jaLabel}
                    style={{
                        touchAction: "manipulation",
                        WebkitTapHighlightColor: "transparent",
                    }}
                >
                    {jaLabel}
                </button>

                <button
                    type="button"
                    onClick={onSetEn}
                    aria-pressed={locale === "en"}
                    className={`rounded-md whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-white/30 transition-colors font-normal
            px-2.5 py-0.5 text-xs min-h-[44px] flex items-center justify-center ${locale === "en" ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                    aria-label={enLabel}
                    style={{
                        touchAction: "manipulation",
                        WebkitTapHighlightColor: "transparent",
                    }}
                >
                    {enLabel}
                </button>
            </div>
        </div>
    );
}
