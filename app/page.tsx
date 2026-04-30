"use client";

import React from "react";
import FilterBar from "./components/FilterBar";
import LocaleToggle from "./components/LocaleToggle";
import { useLocale } from "./i18n/context";

import useGallery from "../lib/hooks/useGallery";
import GalleryGrid from "./components/GalleryGrid";
import GalleryModal from "./components/GalleryModal";
import { capitalize } from "../lib/utils/string";
import { generateStructuredData, generateOrganizationStructuredData } from "../lib/utils/seo";
import { usePhotos } from "../lib/hooks/usePhotos";

export default function Page() {
  const { locale, setLocale, labels } = useLocale();
  const { photos } = usePhotos();

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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationData) }}
      />
      <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
        <div className="flex flex-row items-start justify-between gap-3 sm:gap-4 mb-4 sm:mb-6 min-h-[64px]">
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
          onChange={setFilters}
          className="mb-4"
          locale={locale}
          categoryDisplayMap={categoryDisplayMap}
        />

        <>
          <div className="mb-3 sm:mb-4 text-xs sm:text-sm text-white/70">
            {locale === "en"
              ? `${labels.gallery?.resultsCount ?? "Results"}: ${filteredPhotos.length}`
              : `${labels.gallery?.resultsCount ?? "結果"}: ${filteredPhotos.length} 件`}
          </div>

          {filteredPhotos.length === 0 && PHOTOS.length > 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-white/60">
              <p className="text-sm">
                {locale === "en" ? "No photos match the current filters." : "条件に一致する写真がありません。"}
              </p>
              <button
                onClick={() => setFilters({ category: "all", selectedTags: [], query: "", sort: "new" })}
                className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
                style={{ touchAction: "manipulation" }}
              >
                {locale === "en" ? "Reset filters" : "フィルターをリセット"}
              </button>
            </div>
          ) : (
            <GalleryGrid
              photos={filteredPhotos}
              onOpen={open}
              locale={locale}
              categoryDisplayMap={categoryDisplayMap}
            />
          )}
        </>

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
