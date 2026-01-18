// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import HeaderNav from "./components/HeaderNav";
import ToastProvider from "./components/ToastProvider";
import { AuthProvider } from "./auth/context";
import { LocaleProvider } from "./i18n/context";
import { siteConfig } from "../lib/utils/seo";

const inter = Inter({ subsets: ["latin"], weight: ["400", "700", "900"] });

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
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
    locale: "ja_JP",
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
    images: [
      {
        url: siteConfig.ogImage,
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
    images: [siteConfig.ogImage],
    creator: siteConfig.twitterHandle,
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
  return (
    <html lang="ja">
      <body className={`${inter.className} min-h-screen flex flex-col bg-black text-white`}>
        <ToastProvider>
          <LocaleProvider>
            <AuthProvider>
              {/* Header: 太めの下線ではっきり分離 */}
              <header className="sticky top-0 z-50 bg-black/40 backdrop-blur-sm border-b-4 border-white/30">
                <div className="max-w-5xl mx-auto flex items-center justify-between h-[72px] md:h-[88px] px-6 md:px-8">
                  <h1 className={`${inter.className} text-3xl md:text-4xl font-bold tracking-tight`}>
                    <Link href="/" className="inline-block hover:opacity-80 transition-opacity">
                      PhotoGallery
                    </Link>
                  </h1>

                  <HeaderNav />
                </div>
              </header>

              {/* Main - 各ページで管理 */}
              <div className="flex-1">
                {children}
              </div>
            </AuthProvider>
          </LocaleProvider>
        </ToastProvider>

        {/* Footer */}
        <footer className="border-t border-white/10">
          <div className="max-w-5xl mx-auto px-6 py-6 text-sm text-white/60">
            © 2025 PhotoGallery. All rights reserved.
          </div>
        </footer>
      </body>
    </html>
  );
}
