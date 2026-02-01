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
        description: "旅先で撮った写真をまとめた、小さなギャラリーです。",
      },
      navigation: {
        title: "ナビゲーション",
        works: navLabels.works || "作品",
        gallery: navLabels.gallery || "ギャラリー",
        about: navLabels.about || "制作について",
        favorites: navLabels.favorites || "お気に入り",
        history: navLabels.history || "閲覧履歴",
        news: navLabels.news || "お知らせ",
      },
      copyright: `© ${new Date().getFullYear()} PhotoGallery. All rights reserved.`,
      madeWith: "写真のために",
    },
    en: {
      brand: {
        title: "PhotoGallery",
        description: "A small gallery of photos from my travels.",
      },
      navigation: {
        title: "Navigation",
        works: navLabels.works || "Works",
        gallery: navLabels.gallery || "Gallery",
        about: navLabels.about || "About",
        favorites: navLabels.favorites || "Favorites",
        history: navLabels.history || "History",
        news: navLabels.news || "News",
      },
      copyright: `© ${new Date().getFullYear()} PhotoGallery. All rights reserved.`,
      madeWith: "for photography",
    },
  };

  const content = footerContent[locale] || footerContent.en;

  return (
    <footer className="relative border-t border-white/10 bg-black">
      <div className="relative max-w-5xl mx-auto px-6 md:px-8 py-10 md:py-14">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-10 md:gap-16">
          {/* ブランドセクション */}
          <div className="space-y-2">
            <h3 className="text-xl font-bold tracking-tight text-white">
              {content.brand.title}
            </h3>
            <p className="text-sm text-white/50 max-w-sm leading-relaxed">
              {content.brand.description}
            </p>
          </div>

          {/* ナビゲーションセクション */}
          <div className="min-w-0">
            <h4 className="text-xs font-semibold text-white/70 uppercase tracking-widest mb-4">
              {content.navigation.title}
            </h4>
            <nav
              className="flex flex-wrap gap-x-6 gap-y-2 md:gap-x-8 md:gap-y-2"
              aria-label={content.navigation.title}
            >
              <Link href="/" className="text-sm text-white/60 hover:text-white transition-colors duration-200">
                {content.navigation.works}
              </Link>
              <Link href="/gallery" className="text-sm text-white/60 hover:text-white transition-colors duration-200">
                {content.navigation.gallery}
              </Link>
              <Link href="/news" className="text-sm text-white/60 hover:text-white transition-colors duration-200">
                {content.navigation.news}
              </Link>
              <Link href="/favorites" className="text-sm text-white/60 hover:text-white transition-colors duration-200">
                {content.navigation.favorites}
              </Link>
              <Link href="/history" className="text-sm text-white/60 hover:text-white transition-colors duration-200">
                {content.navigation.history}
              </Link>
              <Link href="/about" className="text-sm text-white/60 hover:text-white transition-colors duration-200">
                {content.navigation.about}
              </Link>
            </nav>
          </div>
        </div>

        <div className="mt-10 md:mt-12 pt-6 md:pt-8 border-t border-white/10">
          <p className="text-xs text-white/40">
            © {new Date().getFullYear()} PhotoGallery
          </p>
        </div>
      </div>
    </footer>
  );
}
