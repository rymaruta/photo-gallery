// app/about/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import Head from "next/head";
import Image from "next/image";
import getContent, { AboutContent } from "./i18n/about";
import { getLabels } from "../i18n/labels";
import LocaleToggle from "../components/LocaleToggle";

export default function AboutPage() {
    const [locale, setLocale] = useState<"ja" | "en">("ja");
    const about = useMemo<AboutContent>(() => getContent(locale), [locale]);

    // shared labels from i18n (used mainly for LocaleToggle labels and safe fallbacks)
    const labels = useMemo(() => getLabels(locale), [locale]);

    const paras = Array.isArray(about.paragraphs)
        ? about.paragraphs
        : about.body
            ? about.body.split(/\r?\n/).filter(Boolean)
            : [];

    // LocaleToggle expects labels.ui.language shape in your Page — keep a safe fallback
    const localeLabels = labels.ui?.language ?? { ja: "日本語", en: "English" };

    // Use about.* first, then fallback to labels.site.* if missing
    const headerTitle = about.title ?? labels.site?.title ?? "About";
    const headerSubtitle = about.description ?? labels.site?.subtitle ?? "";

    return (
        <>
            <Head>
                <title>{headerTitle}</title>
                <meta name="description" content={headerSubtitle} />
                <link rel="canonical" href="https://your-domain.example/about" />
            </Head>

            <main className="p-8 min-h-screen text-white">
                <div className="flex items-start justify-between gap-4 mb-6 min-h-[64px]">
                    <div>
                        <h1 id="site-title" className="text-3xl font-bold">
                            {headerTitle}
                        </h1>

                        {headerSubtitle ? (
                            <p id="site-subtitle" className="text-sm text-white/60 mt-1">
                                {headerSubtitle}
                            </p>
                        ) : null}
                    </div>

                    <LocaleToggle locale={locale} setLocale={setLocale} labels={localeLabels} />
                </div>

                <div className="mx-auto max-w-screen-lg px-6 py-6 md:py-12">
                    <section className="grid grid-cols-1 md:grid-cols-3 gap-10 items-start">
                        <aside className="md:col-span-1 flex flex-col items-start gap-6">
                            <div className="w-28 h-28 md:w-44 md:h-44 rounded-full overflow-hidden bg-gray-900 ring-1 ring-white/6">
                                <Image
                                    src="/images/me-portrait.jpg"
                                    alt={
                                        about.photographer?.name
                                            ? `${about.photographer.name} — portrait`
                                            : "portrait"
                                    }
                                    width={440}
                                    height={440}
                                    sizes="(max-width: 768px) 96px, 176px"
                                    className="w-full h-full object-cover object-center"
                                    priority
                                />
                            </div>

                            <div>
                                <h2 className="text-lg md:text-2xl font-semibold">
                                    {about.photographer?.name ?? (locale === "ja" ? "丸田 竜平" : "Ryuhei Maruta")}
                                </h2>
                                <p className="mt-1 text-sm text-gray-300">
                                    {about.photographer?.title ?? (locale === "ja" ? "写真家" : "Photographer")}
                                </p>
                            </div>

                            <div className="flex items-center gap-3">
                                <a
                                    href="https://www.instagram.com/your_handle"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-sm text-white/90 hover:text-white transition"
                                    aria-label="Instagram"
                                >
                                    <Image src="/Instagram.svg" alt="Instagram" width={20} height={20} className="inline-block" />
                                    <span className="text-sm text-white/80">Instagram</span>
                                </a>
                            </div>

                            <div className="mt-4 text-xs text-white/30">
                                <span>{about.contactLine ?? "Prints • Exhibitions • Limited editions"}</span>
                            </div>
                        </aside>

                        <article className="md:col-span-2">
                            <div className="rounded-xl p-6 md:p-8 bg-gradient-to-b from-white/2 to-transparent ring-1 ring-white/6 backdrop-blur-sm">
                                <div className="space-y-6 text-base md:text-lg leading-relaxed text-gray-200">
                                    {paras.length > 0 ? (
                                        paras.map((p, i) => (
                                            <p key={i} className="m-0">
                                                {p}
                                            </p>
                                        ))
                                    ) : (
                                        <p className="text-gray-400">No content available.</p>
                                    )}
                                </div>
                            </div>
                        </article>
                    </section>
                </div>
            </main>
        </>
    );
}
