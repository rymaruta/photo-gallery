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

    if (gaId) {
        return (
            <>
                <Script
                    src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
                    strategy="afterInteractive"
                />
                <Script id="ga4-init" strategy="afterInteractive">
                    {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');`}
                </Script>
            </>
        );
    }

    return null;
}
