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
        <div className={`flex items-center justify-end ${wrapperWidth} ${className}`}>
            <div className="rounded-full bg-white/[0.07] p-0.5 flex items-center gap-0.5">
                <button
                    type="button"
                    onClick={onSetJa}
                    aria-pressed={locale === "ja"}
                    className={`rounded-full whitespace-nowrap focus:outline-none focus:ring-0 transition-colors
            px-3 text-xs ${locale === "ja" ? "bg-white text-black font-medium" : "text-white/60 hover:text-white/90"}`}
                    aria-label={jaLabel}
                    style={{
                        touchAction: "manipulation",
                        WebkitTapHighlightColor: "transparent",
                        minHeight: "28px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}
                >
                    {jaLabel}
                </button>

                <button
                    type="button"
                    onClick={onSetEn}
                    aria-pressed={locale === "en"}
                    className={`rounded-full whitespace-nowrap focus:outline-none focus:ring-0 transition-colors
            px-3 text-xs ${locale === "en" ? "bg-white text-black font-medium" : "text-white/60 hover:text-white/90"}`}
                    aria-label={enLabel}
                    style={{
                        touchAction: "manipulation",
                        WebkitTapHighlightColor: "transparent",
                        minHeight: "28px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}
                >
                    {enLabel}
                </button>
            </div>
        </div>
    );
}
