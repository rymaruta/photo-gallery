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
  description: "Next.js + Tailwind Layout Example",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${inter.className} min-h-screen flex flex-col`}>
        {/* Header: 太めの下線ではっきり分離 */}
        <header className="sticky top-0 z-50 bg-black/40 backdrop-blur-sm border-b-4 border-white/30 site-header">
          <div className="max-w-screen-lg mx-auto flex items-center justify-between h-[72px] md:h-[88px] px-6 md:px-8">
            <h1 className="site-header__logo">
              PhotoGallery
            </h1>

            <HeaderNav />

          </div>
        </header>


        {/* Main */}
        <main className="flex-1 max-w-screen-lg mx-auto p-6 w-full">
          {children}
        </main>

        {/* Footer */}
        {/* app/layout.tsx の footer */}
        {/* Footer */}
        <footer className="site-footer">
          <div className="site-footer__inner">
            © 2025 PhotoGallery. All rights reserved.
          </div>
        </footer>


      </body>
    </html>
  );
}
