"use client";

import React from "react";
import FilterBar from "./components/FilterBar";
import LocaleToggle from "./components/LocaleToggle";
import { useLocale } from "./i18n/context";

import type { Photo } from "./data/photos";
import useGallery from "./hooks/useGallery";
import GalleryGrid from "./components/GalleryGrid";
import GalleryModal from "./components/GalleryModal";
import { capitalize } from "../lib/utils/string";
import { generateStructuredData, generateOrganizationStructuredData, generateCollectionPageStructuredData } from "../lib/utils/seo";
import { log } from "../lib/utils/log";

export default function Page() {
  const { locale, setLocale, labels } = useLocale();
  const [photos, setPhotos] = React.useState<Photo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);

  const loadPhotos = React.useCallback(async () => {
    setLoadError(false);
    setLoading(true);
    try {
      const { publicFetch } = await import("../lib/utils/api");
      const response = await publicFetch("/photos", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        setPhotos(data);
      } else {
        log.error("写真の取得に失敗しました");
        setLoadError(true);
      }
    } catch (error) {
      log.error("写真取得エラー:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

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

  const collectionPageData = React.useMemo(
    () => generateCollectionPageStructuredData(PHOTOS),
    [PHOTOS]
  );

  const organizationData = React.useMemo(
    () => generateOrganizationStructuredData(),
    []
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionPageData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationData) }}
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

        {loading && !loadError ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" aria-hidden />
            <p className="sr-only">読み込み中</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-white/80 mb-4">写真の読み込みに失敗しました</p>
            <button
              type="button"
              onClick={() => loadPhotos()}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              再試行
            </button>
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
