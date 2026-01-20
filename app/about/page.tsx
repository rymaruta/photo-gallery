// app/about/page.tsx
"use client";

import React, { useMemo } from "react";
import Head from "next/head";
import Image from "next/image";
import getContent, { AboutContent } from "../i18n/about";
import { useLocale } from "../i18n/context";
import LocaleToggle from "../components/LocaleToggle";
import ProtectedPortrait from "../components/ProtectedPortrait";

export default function AboutPage() {
    const { locale, setLocale, labels } = useLocale();
    const about = useMemo<AboutContent>(() => getContent(locale), [locale]);

    // paragraphs を配列としてそのまま扱い、空文字で改行を表現する
    const paras = Array.isArray(about.paragraphs)
        ? about.paragraphs
        : about.body
            ? about.body.split(/\r?\n/).map((s) => s.trim())
            : [];

    const localeLabels = labels.ui?.language ?? { ja: "日本語", en: "English" };

    // ページヘッダ
    const headerTitle = about.title ?? labels.site?.title ?? "About";
    const headerSubtitle = about.description ?? labels.site?.subtitle ?? "";

    // i18n からのみ取得（フォールバックを削除）
    const contactUrl = about.contactUrl ?? "";
    const contactHandle = about.contactHandle ?? "";
    const contactTitle = about.contactTitle; // i18n 側に必ず設定してください
    const contactPrompt = about.contactPrompt; // i18n 側に必ず設定してください
    const updatesLine = about.updatesLine ?? "";

    return (
        <>
            <Head>
                <title>{headerTitle}</title>
                <meta name="description" content={headerSubtitle} />
                <link rel="canonical" href="https://your-domain.example/about" />
            </Head>

            <main className="p-6 sm:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
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

                    <div className="mx-auto max-w-screen-lg px-4 md:px-6 py-6 md:py-12">
                        <section className="grid grid-cols-1 md:grid-cols-3 gap-10 items-start">
                            {/* 左カラム（肖像＋名前＋SNS） */}
                            <aside className="md:col-span-1 flex flex-col items-start gap-6">
                                <ProtectedPortrait
                                    src="/snsimages/me-portrait.jpg"
                                    alt={about.photographer?.name ? `${about.photographer.name} — portrait` : "portrait"}
                                    sizes="(max-width: 768px) 96px, 176px"
                                    className="w-28 h-28 md:w-44 md:h-44"
                                />

                                <div>
                                    <h2 className="text-lg md:text-2xl font-semibold">
                                        {about.photographer?.name ?? ""}
                                    </h2>
                                    <p className="mt-1 text-sm text-gray-300">
                                        {about.photographer?.title ?? ""}
                                    </p>
                                </div>

                                {/* Instagram アイコンとハンドル（contactHandle が空ならハンドルは表示されません） */}
                                {contactUrl ? (
                                    <div className="flex items-center gap-3">
                                        <a
                                            href={contactUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 text-sm text-white/90 hover:text-white transition"
                                            aria-label="Instagram (opens in a new tab)"
                                        >
                                            <Image src="/Instagram.svg" alt="Instagram" width={20} height={20} className="inline-block" />
                                            {contactHandle ? <span className="text-sm text-white/80">{contactHandle}</span> : null}
                                        </a>
                                    </div>
                                ) : null}
                            </aside>

                            {/* 右カラム（本文） */}
                            <article className="md:col-span-2">
                                <div className="rounded-xl p-6 md:p-8 bg-gradient-to-b from-white/2 to-transparent ring-1 ring-white/6 backdrop-blur-sm">
                                    <div className="text-base md:text-lg leading-relaxed text-gray-200">
                                        {paras.length > 0 ? (
                                            paras.map((p, i) =>
                                                p === "" ? (
                                                    <div key={`br-${i}`} className="my-4" aria-hidden />
                                                ) : (
                                                    <p key={i} className="m-0 mb-4">
                                                        {p}
                                                    </p>
                                                )
                                            )
                                        ) : (
                                            <p className="text-gray-400">No content available.</p>
                                        )}

                                        {/* 本文下：i18n から取得した文言のみ表示 */}
                                        <div className="mt-6 pt-6 border-t border-white/6">
                                            {contactTitle ? <p className="text-xs text-white/60 mb-2">{contactTitle}</p> : null}

                                            {contactPrompt ? <p className="text-sm text-white/90">{contactPrompt}</p> : null}

                                            {updatesLine ? <p className="mt-2 text-xs text-white/60">{updatesLine}</p> : null}
                                        </div>
                                    </div>
                                </div>
                            </article>
                        </section>
                    </div>
            </main>
        </>
    );
}
