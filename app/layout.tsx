// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Inter, Playfair_Display } from "next/font/google";
import HeaderNav from "./components/HeaderNav";

const inter = Inter({ subsets: ["latin"], weight: ["400", "700"] });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["700"] });

export const metadata: Metadata = {
  title: "PhotoGallery",
  description: "小さな写真サイトへようこそ。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${inter.className} min-h-screen flex flex-col bg-black text-white`}>
        {/* Header: 太めの下線ではっきり分離 */}
        <header className="sticky top-0 z-50 bg-black/40 backdrop-blur-sm border-b-4 border-white/30">
          <div className="max-w-5xl mx-auto flex items-center justify-between h-[72px] md:h-[88px] px-6 md:px-8">
            <h1 className={`${playfair.className} text-xl md:text-2xl font-bold tracking-tight`}>
              <Link href="/" className="inline-block">
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
