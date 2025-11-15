// app/page.tsx
"use client";

import React from "react";
import Image from "next/image";
import FilterBar, { FilterValues } from "./components/FilterBar";
import LocaleToggle from "./components/LocaleToggle";
import { getLabels } from "./i18n/labels";

import type { Photo } from "./data/photos";
import { RAW_PHOTOS } from "./data/photos";
import useGallery from "./hooks/useGallery";
import GalleryGrid from "./components/GalleryGrid";
import GalleryModal from "./components/GalleryModal";

const capitalize = (s?: string) => {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function Page() {
  const [locale, setLocale] = React.useState<"ja" | "en">("ja");
  const labels = React.useMemo(() => getLabels(locale), [locale]);

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
  } = useGallery(RAW_PHOTOS as Photo[]);

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

  return (
    <main className="p-6 sm:p-8 min-h-screen text-white bg-black">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6 min-h-[64px]">
          <div>
            <h1 id="site-title" className="text-3xl font-bold">
              {labels.site?.title ?? "Gallery"}
            </h1>

            {labels.site?.subtitle ? (
              <p id="site-subtitle" className="text-sm text-white/60 mt-1" aria-hidden={false}>
                {labels.site.subtitle}
              </p>
            ) : null}
          </div>

          <LocaleToggle
            locale={locale}
            setLocale={setLocale}
            labels={labels.ui?.language ?? { ja: "日本語", en: "English" }}
          />
        </div>

        <FilterBar
          categories={categories}
          tags={tags}
          values={filters as unknown as FilterValues}
          onChange={(next) => setFilters(next as any)}
          className="mb-4"
          locale={locale}
          categoryDisplayMap={categoryDisplayMap}
        />

        <div className="mb-4 text-sm text-white/70">結果: {filteredPhotos.length} 件</div>

        <GalleryGrid photos={filteredPhotos} onOpen={open} categoryDisplayMap={categoryDisplayMap} />

        {currentIndex !== null && filteredPhotos[currentIndex] && (
          <GalleryModal
            photos={filteredPhotos}
            currentIndex={currentIndex}
            onClose={close}
            onNext={next}
            onPrev={prev}
            categoryDisplayMap={categoryDisplayMap}
          />
        )}
      </div>
    </main>
  );
}
