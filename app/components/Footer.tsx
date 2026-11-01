"use client";

import Link from "next/link";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";

export default function Footer() {
    const { locale, labels } = useLocale();
    const navLabels = labels.navigation || {};

    const links = [
        { href: ROUTES.HOME, label: navLabels.works || (locale === "en" ? "Works" : "作品") },
        { href: ROUTES.MAP, label: navLabels.map || (locale === "en" ? "Map" : "撮影地マップ") },
        { href: ROUTES.SPOTS, label: locale === "en" ? "Photo spots" : "撮影スポット" },
        { href: ROUTES.FAVORITES, label: navLabels.favorites || (locale === "en" ? "Liked Photos" : "いいねした写真") },
        { href: ROUTES.SAVES, label: navLabels.saves || (locale === "en" ? "Saved Photos" : "保存した写真") },
        { href: ROUTES.SAVED_SPOTS, label: locale === "en" ? "Want to go" : "行きたい場所" },
        { href: ROUTES.TERMS, label: locale === "en" ? "Terms" : "利用規約" },
        { href: ROUTES.PRIVACY, label: locale === "en" ? "Privacy" : "プライバシーポリシー" },
    ];

    return (
        <footer className="border-t border-line bg-bg" style={{ paddingBottom: "var(--page-bar-h, 0px)" }}>
            <div className="mx-auto max-w-5xl px-6 py-10 md:px-8 md:py-12">
                <div className="flex flex-col items-center gap-6 text-center">
                    <div className="flex flex-col items-center gap-3">
                        <div className="inline-flex items-center justify-center gap-3">
                            {/* ヘッダー・アプリアイコンと共通の公式アパーチャロゴ */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src="/logo-aperture.png"
                                alt=""
                                aria-hidden="true"
                                width={40}
                                height={40}
                                decoding="async"
                                className="h-9 w-9 flex-shrink-0"
                            />
                            <p className="m-0 font-wordmark text-[26px] font-semibold tracking-tight text-white">
                                Journey Photo
                            </p>
                        </div>
                        <p className="text-[15px] leading-[22px] text-text-2">
                            {locale === "en" ? "Moments that move someone's next journey." : "旅の一瞬を、誰かの次の旅へ。"}
                        </p>
                    </div>

                    <div className="h-px w-full max-w-[640px] bg-line" />

                    <nav
                        aria-label={locale === "en" ? "Footer" : "フッター"}
                        className="grid w-full max-w-[640px] grid-cols-2 gap-x-5 sm:grid-cols-4 sm:gap-x-6"
                    >
                        {links.map(({ href, label }) => (
                            <Link
                                key={href}
                                href={href}
                                prefetch={false}
                                className="inline-flex min-h-[44px] items-center justify-center px-1 text-text-2 transition-colors hover:text-accent"
                                style={{ fontSize: "13px", lineHeight: "18px", touchAction: "manipulation" }}
                            >
                                {label}
                            </Link>
                        ))}
                    </nav>

                    <p className="text-[13px] leading-[18px] text-text-3">© Journey Photo</p>
                </div>
            </div>
        </footer>
    );
}
