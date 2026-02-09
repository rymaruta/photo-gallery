// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import HeaderNav from "./components/HeaderNav";
import Footer from "./components/Footer";
import ToastProvider from "./components/ToastProvider";
import { AuthProvider } from "./auth/context";
import { LocaleProvider } from "./i18n/context";
import { PwaRegister } from "./components/PwaRegister";
import RootErrorBoundary from "./components/RootErrorBoundary";
import { siteConfig, generateWebSiteStructuredData } from "../lib/utils/seo";

const inter = Inter({ subsets: ["latin"], weight: ["400", "700", "900"] });

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", type: "image/png", sizes: "any" },
    ],
  },
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: ["写真", "ギャラリー", "作品", "photography", "gallery", "works"],
  authors: [{ name: "PhotoGallery" }],
  creator: "PhotoGallery",
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
    languages: {
      ja: siteConfig.url,
      en: siteConfig.url,
      "x-default": siteConfig.url,
    },
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
    google: "_QSo4q7u-jzoQB5kyyIHeVlgFjunVL--4P1u6ORaW9M",
  },
  other: {
    "format-detection": "telephone=no",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const webSiteStructuredData = generateWebSiteStructuredData();
  
  return (
    <html lang="ja">
      <head>
        {/* リソースヒント: パフォーマンス最適化 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={siteConfig.url} />
        {/* 画像（/uploads/）のオリジンへ事前接続し、一覧の画像表示を高速化 */}
        <link rel="preconnect" href={new URL(siteConfig.url).origin} />
        {/* 本番API（CloudFront等）のオリジンへ事前接続し、/photos 取得を高速化 */}
        {process.env.NEXT_PUBLIC_API_BASE_URL?.startsWith("http") && (
          <link rel="preconnect" href={new URL(process.env.NEXT_PUBLIC_API_BASE_URL).origin} />
        )}
        {/* 一覧データは page の fetch で取得。preload は「数秒以内に使う」必要があり React の fetch とずれるため未使用警告が出るため付けない */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteStructuredData) }}
        />
      </head>
      <body className={`${inter.className} min-h-screen flex flex-col bg-black text-white safe-area-body`}>
        <PwaRegister />
        <RootErrorBoundary>
          <ToastProvider>
            <LocaleProvider>
              <AuthProvider>
                {/* Header: 黒背景に白字のモダンなデザイン（z-[200] で他要素より前面にし、ボタンが確実に反応するようにする） */}
                <header className="sticky top-0 z-[200] bg-black/60 backdrop-blur-md border-b border-white/10 isolate safe-area-header">
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none select-none" aria-hidden="true" />
                <div className="relative z-[1] max-w-5xl mx-auto flex items-center justify-between h-[64px] md:h-[72px] px-4 sm:px-6 md:px-8" style={{ pointerEvents: "auto" }}>
                  <h1 className={`${inter.className} text-2xl md:text-3xl font-bold tracking-tight text-white`}>
                    <Link 
                      href="/" 
                      prefetch={false}
                      className="inline-block hover:opacity-70 transition-opacity duration-200 relative group"
                    >
                      <span className="relative z-10">PhotoGallery</span>
                      <span className="absolute inset-0 bg-white/5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 -z-0" />
              </Link>
            </h1>

            <HeaderNav />
          </div>
        </header>

        {/* Main - 各ページで管理（スタックコンテキストを分離し、ヘッダー下で確実にクリック可能に） */}
          <div className="flex-1 relative z-0">
            {children}
          </div>

                {/* Footer: 公式サイト風の洗練されたデザイン */}
                <Footer />
              </AuthProvider>
            </LocaleProvider>
          </ToastProvider>
        </RootErrorBoundary>
      </body>
    </html>
  );
}
