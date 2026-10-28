"use client";

import Script from "next/script";
import { siteConfig } from "../../lib/utils/seo";

/**
 * アクセス解析タグ。設定されている時だけ出力する（未設定なら null＝完全に無害）。
 * 優先: Plausible（Cookieless）→ GA4。値はすべて公開情報。
 */
export default function Analytics() {
    const { gaId, plausibleDomain } = siteConfig;

    if (plausibleDomain) {
        return (
            <Script
                defer
                data-domain={plausibleDomain}
                src="https://plausible.io/js/script.js"
                strategy="afterInteractive"
            />
        );
    }

    // **GA4 は `lazyOnload`（2026-10-28）。** `afterInteractive` の外部スクリプトは
    // Next が `<head>` に `<link rel="preload" as="script">` を出すので、gtag.js
    // （本番の ID で gzip 約 175KB）が**最初の描画・代表写真と同じ時期に**回線を
    // 取り合っていた（PageSpeed Insights・スマホで指摘）。`lazyOnload` は先読みを出さず、
    // ページの `load` のあと手が空いたときに読む。
    // 代償: `load` より前に離れた人のページビューは数えられない（測り方が変わる）
    if (gaId) {
        return (
            <>
                <Script
                    src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
                    strategy="lazyOnload"
                />
                <Script id="ga4-init" strategy="lazyOnload">
                    {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');`}
                </Script>
            </>
        );
    }

    return null;
}
