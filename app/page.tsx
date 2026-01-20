"use client";

import React from "react";
import FilterBar from "./components/FilterBar";
import LocaleToggle from "./components/LocaleToggle";
import { useLocale } from "./i18n/context";

import type { Photo } from "./data/photos";
import useGallery from "./hooks/useGallery";
import GalleryGrid from "./components/GalleryGrid";
import GalleryModal from "./components/GalleryModal";
import type { FilterValues } from "../lib/types/gallery";
import { capitalize } from "../lib/utils/string";
import { generateStructuredData } from "../lib/utils/seo";

export default function Page() {
  const { locale, setLocale, labels } = useLocale();
  const [photos, setPhotos] = React.useState<Photo[]>([]);
  const [loading, setLoading] = React.useState(true);

  // APIから写真を読み込む（編集済みのベース写真も含む）
  React.useEffect(() => {
    const loadPhotos = async () => {
      try {
        const response = await fetch("/api/photos", { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          setPhotos(data);
        } else {
          console.error("写真の取得に失敗しました");
        }
      } catch (error) {
        console.error("写真取得エラー:", error);
      } finally {
        setLoading(false);
      }
    };

    loadPhotos();
  }, []);

  const {
    PHOTOS,
    filters,
    setFilters,
    filteredPhotos,
    currentIndex,
    open,
    close,
    next,
    prev,
  } = useGallery(photos);

  // URLパラメータから画像IDを取得してモーダルを開く
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    
    const params = new URLSearchParams(window.location.search);
    const photoId = params.get("photo");
    
    if (photoId && filteredPhotos.length > 0) {
      const index = filteredPhotos.findIndex(p => p.id === photoId);
      if (index !== -1) {
        open(index);
        // URLからパラメータを削除（履歴に残さない）
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);
      }
    }
  }, [filteredPhotos, open]);

  const categories = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of PHOTOS) {
      if (p.category) set.add(p.category);
    }
    return [...Array.from(set)];
  }, [PHOTOS]);

  const tags = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of PHOTOS) {
      for (const t of p.tags ?? []) set.add(t);
    }
    return Array.from(set);
  }, [PHOTOS]);

  const categoryDisplayMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    const names = labels.category.names ?? {};
    for (const key of categories) {
      map[key] = key === "all" ? labels.category.all : names[key] ?? capitalize(key.replace(/-/g, " "));
    }
    for (const p of PHOTOS) {
      const k = (p.category ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");
      if (k && !map[k]) map[k] = names[k] ?? capitalize(k.replace(/-/g, " "));
    }
    return map;
  }, [labels, categories, PHOTOS]);

  // subtitle を string | string[] のどちらでも扱うヘルパー（モバイルでタイトに詰める）
  const renderSubtitle = (sub?: string | string[]) => {
    if (!sub) return null;
    const parts = Array.isArray(sub) ? sub : [sub];
    const first = parts[0] ?? "";
    const rest = parts.slice(1).join(" ");

    return (
      <p
        id="site-subtitle"
        className="text-sm text-white/60 mt-0.5 sm:mt-1 leading-tight sm:leading-normal"
      >
        {/* モバイル: inline-block + 改行で安定して詰める。sm以上はインラインで続ける */}
        <span className="inline-block align-baseline sm:inline">{first}</span>
        {/* モバイルのみ確実に改行 */}
        {rest ? <br className="block sm:hidden" /> : null}
        {rest ? (
          <span
            // モバイルでは微負の上マージンで段落間を詰める。必要なら値を調整してください。
            className="inline-block align-baseline sm:inline -mt-1 sm:mt-0"
            style={{ lineHeight: "1.05" }}
          >
            {rest}
          </span>
        ) : null}
      </p>
    );
  };

  // 構造化データ（JSON-LD）
  const structuredData = React.useMemo(
    () => generateStructuredData(PHOTOS),
    [PHOTOS]
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6 min-h-[64px]">
          <div className="flex-1">
            <h1 id="site-title" className="text-2xl sm:text-3xl font-bold mb-0">
              {labels.site?.title ?? "Gallery"}
            </h1>

            {renderSubtitle(labels.site?.subtitle)}
          </div>

          <div className="flex-shrink-0">
            <LocaleToggle
              locale={locale}
              setLocale={setLocale}
              labels={labels.ui?.language ?? { ja: "日本語", en: "English" }}
            />
          </div>
        </div>

        <FilterBar
          categories={categories}
          tags={tags}
          values={filters}
          onChange={(next) => setFilters(next)}
          className="mb-4"
          locale={locale}
          categoryDisplayMap={categoryDisplayMap}
        />

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-12 h-12 border-3 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="mb-3 sm:mb-4 text-xs sm:text-sm text-white/70">
              {locale === "en" 
                ? `${labels.gallery?.resultsCount ?? "Results"}: ${filteredPhotos.length}`
                : `${labels.gallery?.resultsCount ?? "結果"}: ${filteredPhotos.length} 件`}
            </div>

            <GalleryGrid
              photos={filteredPhotos}
              onOpen={open}
              locale={locale}
              categoryDisplayMap={categoryDisplayMap}
            />
          </>
        )}

        {currentIndex !== null && filteredPhotos[currentIndex] && (
          <GalleryModal
            photos={filteredPhotos}
            currentIndex={currentIndex}
            onClose={close}
            onNext={next}
            onPrev={prev}
            locale={locale}
            categoryDisplayMap={categoryDisplayMap}
          />
        )}
      </main>
    </>
  );
}
