"use client";

import Link from "next/link";
import { useLocale } from "../i18n/context";

export default function Footer() {
  const { locale, labels } = useLocale();
  const navLabels = labels.navigation || {};

  const footerContent = {
    ja: {
      brand: {
        title: "PhotoGallery",
        description: "写真作品のキュレーションコレクション。レンズを通して捉えられた瞬間を探索してください。",
      },
      navigation: {
        title: "ナビゲーション",
        gallery: navLabels.gallery || "ギャラリー",
        about: navLabels.about || "制作について",
        favorites: navLabels.favorites || "お気に入り",
        history: navLabels.history || "閲覧履歴",
      },
      information: {
        title: "情報",
        portfolio: "ポートフォリオ & ギャラリー",
        collection: "写真コレクション",
      },
      copyright: `© ${new Date().getFullYear()} PhotoGallery. All rights reserved.`,
      madeWith: "写真のために",
    },
    en: {
      brand: {
        title: "PhotoGallery",
        description: "A curated collection of photography works. Explore moments captured through the lens.",
      },
      navigation: {
        title: "Navigation",
        gallery: navLabels.gallery || "Gallery",
        about: navLabels.about || "About",
        favorites: navLabels.favorites || "Favorites",
        history: navLabels.history || "History",
      },
      information: {
        title: "Information",
        portfolio: "Portfolio & Gallery",
        collection: "Photography Collection",
      },
      copyright: `© ${new Date().getFullYear()} PhotoGallery. All rights reserved.`,
      madeWith: "for photography",
    },
  };

  const content = footerContent[locale] || footerContent.en;

  return (
    <footer className="relative border-t border-white/10 bg-black">
      <div className="relative max-w-5xl mx-auto px-6 md:px-8 py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 mb-8 md:mb-12">
          {/* ブランドセクション */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-white mb-4">{content.brand.title}</h3>
            <p className="text-xs text-white/40 font-light">
              © {new Date().getFullYear()} PhotoGallery
            </p>
          </div>

          {/* ナビゲーションセクション */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-white/90 uppercase tracking-wider mb-4">
              {content.navigation.title}
            </h4>
            <nav className="flex flex-col space-y-3">
              <Link href="/" className="text-sm text-white/60 hover:text-white/90 transition-colors">
                {content.navigation.gallery}
              </Link>
              <Link href="/about" className="text-sm text-white/60 hover:text-white/90 transition-colors">
                {content.navigation.about}
              </Link>
              <Link href="/favorites" className="text-sm text-white/60 hover:text-white/90 transition-colors">
                {content.navigation.favorites}
              </Link>
              <Link href="/history" className="text-sm text-white/60 hover:text-white/90 transition-colors">
                {content.navigation.history}
              </Link>
            </nav>
          </div>

          {/* 情報セクション */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-white/90 uppercase tracking-wider mb-4">
              {content.information.title}
            </h4>
            <div className="flex flex-col space-y-3 text-sm text-white/60">
              <span>{content.information.portfolio}</span>
              <span>{content.information.collection}</span>
            </div>
          </div>
        </div>

      </div>
    </footer>
  );
}
