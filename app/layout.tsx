// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import HeaderNav from "./components/HeaderNav";
import Footer from "./components/Footer";
import ToastProvider from "./components/ToastProvider";
import DisableSave from "./components/DisableSave";
import AssetRecovery from "./components/AssetRecovery";
import ErrorBoundary from "./components/ErrorBoundary";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";
import { AuthProvider } from "./auth/context";
import { MusicProvider } from "./music/MusicContext";
import MiniPlayer from "./components/MiniPlayer";
import { LocaleProvider } from "./i18n/context";
import { siteConfig, generateWebSiteStructuredData } from "../lib/utils/seo";

const inter = Inter({ subsets: ["latin"], weight: ["400", "700", "900"], display: "swap" });

// Instagram IAB / iOS Safari でブラウザUIを除いた実際の表示領域を使う
// viewportFit=cover でノッチ・ホームインジケーター領域の safe-area-inset を有効化
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  manifest: "/manifest.webmanifest",
  title: {
    default: siteConfig.name,
    template: `%s | Journey Photo 旅フォトギャラリー`,
  },
  description: siteConfig.description,
  keywords: [
    "旅行写真", "旅フォト", "旅の写真", "旅行記", "旅行ギャラリー",
    "風景写真", "スナップ写真", "海外旅行", "国内旅行",
    "旅行", "旅", "ジャーニー", "フォト", "写真", "ギャラリー",
    "travel", "journey", "photo", "photography", "travel photography",
  ],
  authors: [{ name: "Journey Photo" }],
  creator: "Journey Photo",
  openGraph: {
    type: "website",
    locale: siteConfig.locale.ja,
    alternateLocale: siteConfig.locale.en,
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
    images: [
      {
        url: siteConfig.ogImage.startsWith("http") 
          ? siteConfig.ogImage 
          : `${siteConfig.url}${siteConfig.ogImage}`,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.ogImage.startsWith("http") 
      ? siteConfig.ogImage 
      : `${siteConfig.url}${siteConfig.ogImage}`],
    creator: siteConfig.twitterHandle,
  },
  alternates: {
    canonical: siteConfig.url,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    // Google Search Console の検証コードを追加する場合
    // google: "your-google-verification-code",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const webSiteStructuredData = generateWebSiteStructuredData();
  
  return (
    <html lang="ja">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteStructuredData).replace(/</g, "\\u003c").replace(/>/g, "\\u003e") }}
        />
      </head>
      <body className={`${inter.className} min-h-screen flex flex-col bg-black text-white`}>
        <DisableSave />
        <AssetRecovery />
        <ErrorBoundary>
        <ServiceWorkerRegister />
        <ToastProvider>
          <LocaleProvider>
            <AuthProvider>
              <MusicProvider>
              {/* Header: 黒背景に白字のモダンなデザイン */}
              <header className="sticky top-0 z-50 bg-black/60 backdrop-blur-md border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                <div className="relative max-w-5xl mx-auto flex items-center justify-between h-[64px] md:h-[72px] px-6 md:px-8">
                  <p className={`${inter.className} text-2xl md:text-3xl font-bold tracking-tight text-white m-0`}>
                    <Link
                      href="/"
                      className="inline-block hover:opacity-70 transition-opacity duration-200 relative group"
                    >
                      <span className="relative z-10">Journey Photo</span>
                      <span className="absolute inset-0 bg-white/5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 -z-0" />
              </Link>
            </p>

            <HeaderNav />
          </div>
        </header>

        {/* Main - 各ページで管理 */}
          <div className="flex-1">
            {children}
          </div>

              {/* Footer: 公式サイト風の洗練されたデザイン */}
              <Footer />

              {/* グローバル音楽のミニプレイヤー（再生中のみ表示） */}
              <MiniPlayer />
              </MusicProvider>
            </AuthProvider>
          </LocaleProvider>
        </ToastProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
