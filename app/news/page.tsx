"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useLocale } from "../i18n/context";
import LocaleToggle from "../components/LocaleToggle";
import getNewsContent, { type NewsItem } from "../i18n/news";

function formatDate(dateStr: string, locale: "ja" | "en"): string {
    try {
        const d = new Date(dateStr);
        if (locale === "ja") {
            return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
        }
        return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    } catch {
        return dateStr;
    }
}

export default function NewsPage() {
    const { locale, setLocale, labels } = useLocale();
    const items = useMemo(() => getNewsContent(locale), [locale]);
    const localeLabels = labels.ui?.language ?? { ja: "日本語", en: "English" };
    const pageTitle = locale === "en" ? "News & Updates" : "お知らせ";
    const pageSubtitle = locale === "en" ? "Updates and announcements" : "更新履歴とお知らせ";
    const emptyMessage = locale === "en" ? "No news yet." : "お知らせはまだありません。";

    return (
        <main className="p-6 sm:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
            <div className="flex items-start justify-between gap-4 mb-6 min-h-[64px]">
                <div>
                    <h1 id="site-title" className="text-3xl font-bold">
                        {pageTitle}
                    </h1>
                    <p className="text-sm text-white/60 mt-1">
                        {pageSubtitle}
                    </p>
                </div>
                <LocaleToggle locale={locale} setLocale={setLocale} labels={localeLabels} />
            </div>

            {items.length === 0 ? (
                <p className="text-white/70">{emptyMessage}</p>
            ) : (
                <ul className="list-none p-0 m-0 space-y-8">
                    {items.map((item: NewsItem) => (
                        <li key={`${item.date}-${item.title}`} className="border-b border-white/10 pb-6 last:border-b-0">
                            <time
                                dateTime={item.date}
                                className="block text-xs text-white/50 mb-1"
                            >
                                {formatDate(item.date, locale)}
                            </time>
                            <h2 className="text-lg font-semibold mb-2">
                                {item.title}
                            </h2>
                            <p className="text-sm text-white/80 whitespace-pre-line leading-relaxed">
                                {item.body}
                            </p>
                        </li>
                    ))}
                </ul>
            )}

            <div className="mt-10">
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors"
                >
                    <span>{locale === "en" ? "Back to top" : "トップへ戻る"}</span>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                </Link>
            </div>
        </main>
    );
}
