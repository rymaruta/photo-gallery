"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import FilterBar, { FilterValues } from "./components/FilterBar";
import LocaleToggle from "./components/LocaleToggle";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import { getLabels } from "./i18n/labels";
import type { Photo } from "./data/photos";      // ← パスは実際の配置に合わせて調整
import { RAW_PHOTOS } from "./data/photos";
import GalleryModal from "./components/GalleryModal";

const normalizeKey = (s?: string) =>
  (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");

const capitalize = (s?: string) => {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function Page() {
  const [locale, setLocale] = useState<"ja" | "en">("ja");
  const labels = useMemo(() => getLabels(locale), [locale]);

  const PHOTOS = useMemo<Photo[]>(
    () =>
      RAW_PHOTOS.map((p) => ({
        ...p,
        category: normalizeKey(p.category),
        tags: (p.tags ?? []).map((t) => (t ?? "").toString().trim()).filter(Boolean),
      })),
    []
  );

  const [currentIndex, setCurrentIndex] = useState<number | null>(null);

  const [filters, setFilters] = useState<FilterValues>({
    category: "all",
    selectedTags: [],
    query: "",
    sort: "new",
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of PHOTOS) {
      if (p.category) set.add(p.category);
    }
    return [...Array.from(set)];
  }, [PHOTOS]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const p of PHOTOS) {
      for (const t of p.tags ?? []) set.add(t);
    }
    return Array.from(set);
  }, [PHOTOS]);

  const filteredPhotos = useMemo(() => {
    let arr = PHOTOS.slice();

    if (filters.category !== "all") arr = arr.filter((p) => p.category === filters.category);
    if (filters.selectedTags.length) arr = arr.filter((p) => filters.selectedTags.every((t) => (p.tags || []).includes(t)));
    if (filters.query.trim()) {
      const q = filters.query.toLowerCase();
      arr = arr.filter((p) => ((p.title || "") + " " + (p.description || "")).toLowerCase().includes(q));
    }

    if (filters.sort === "new") arr.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    else if (filters.sort === "old") arr.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    else if (filters.sort === "popular") arr.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));

    return arr;
  }, [filters, PHOTOS]);

  const open = useCallback((i: number) => setCurrentIndex(i), []);
  const showNext = useCallback(() => setCurrentIndex((i) => (i === null ? null : (i + 1) % filteredPhotos.length)), [filteredPhotos.length]);
  const showPrev = useCallback(() => setCurrentIndex((i) => (i === null ? null : (i - 1 + filteredPhotos.length) % filteredPhotos.length)), [filteredPhotos.length]);

  const categoryDisplayMap = useMemo(() => {
    const map: Record<string, string> = {};
    const names = labels.category.names ?? {};
    for (const key of categories) {
      map[key] = key === "all" ? labels.category.all : names[key] ?? capitalize(key.replace(/-/g, " "));
    }
    for (const p of PHOTOS) {
      const k = normalizeKey(p.category);
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
          values={filters}
          onChange={(next) => setFilters((s) => ({ ...s, ...next }))}
          className="mb-4"
          locale={locale}
          categoryDisplayMap={categoryDisplayMap}
        />

        <div className="mb-4 text-sm text-white/70">結果: {filteredPhotos.length} 件</div>

        {/* ギャラリー（画像同士の余白ゼロ、オーバーレイキャプション） */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-0">
          {filteredPhotos.map((p, idx) => (
            <div key={p.id} className="w-full m-0 p-0">
              <button
                onClick={() => open(idx)}
                className="block w-full p-0 border-0 bg-transparent cursor-pointer"
                aria-label={`Open ${p.title}`}
                title={p.title}
                style={{ touchAction: "manipulation" }}
              >
                <div className="relative w-full overflow-hidden" style={{ paddingTop: "75%" }}>
                  <Image
                    src={p.src}
                    alt={p.title}
                    fill
                    className="object-cover"
                    sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                    loading="lazy"
                  />

                  <div
                    className="absolute left-0 right-0 bottom-0 px-2"
                    style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%)" }}
                  >
                    <div className="py-2 sm:py-1">
                      <div className="text-sm sm:text-sm font-semibold text-white truncate" title={p.title}>
                        {p.title}
                      </div>
                      <div className="text-xs text-white/60 truncate" title={categoryDisplayMap[p.category ?? ""]}>
                        {categoryDisplayMap[p.category ?? ""]}
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          ))}
        </div>

        {currentIndex !== null && filteredPhotos[currentIndex] && (
          <GalleryModal
            photos={filteredPhotos}
            currentIndex={currentIndex}
            onClose={() => setCurrentIndex(null)}
            onNext={() => setCurrentIndex((i) => (i === null ? null : (i + 1) % filteredPhotos.length))}
            onPrev={() => setCurrentIndex((i) => (i === null ? null : (i - 1 + filteredPhotos.length) % filteredPhotos.length))}
            categoryDisplayMap={categoryDisplayMap}
          />
        )}

      </div>
    </main>
  );
}
