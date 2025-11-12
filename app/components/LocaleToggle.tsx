"use client";

import React, { useCallback } from "react";

type LocaleLabels = { ja?: string; en?: string };

type Props = {
    locale: "ja" | "en";
    setLocale: (l: "ja" | "en") => void;
    labels: LocaleLabels;
    wrapperWidth?: string; // e.g. "w-[140px] md:w-[160px]"
    className?: string;
};

export default function LocaleToggle({
    locale,
    setLocale,
    labels,
    wrapperWidth = "w-[140px] md:w-[160px]",
    className = "",
}: Props) {
    const onSetJa = useCallback(() => setLocale("ja"), [setLocale]);
    const onSetEn = useCallback(() => setLocale("en"), [setLocale]);

    const jaLabel = labels.ja ?? "日本語";
    const enLabel = labels.en ?? "English";

    return (
        <div className={`flex items-center gap-2 ${wrapperWidth} ${className}`}>
            <div className="rounded-lg bg-white/5 px-1.5 py-1 flex items-center gap-1 w-full justify-end">
                <button
                    type="button"
                    onClick={onSetJa}
                    aria-pressed={locale === "ja"}
                    className={`px-3 py-1 rounded whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-white ${locale === "ja" ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                    aria-label={jaLabel}
                >
                    {jaLabel}
                </button>

                <button
                    type="button"
                    onClick={onSetEn}
                    aria-pressed={locale === "en"}
                    className={`px-3 py-1 rounded whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-white ${locale === "en" ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                    aria-label={enLabel}
                >
                    {enLabel}
                </button>
            </div>
        </div>
    );
}
