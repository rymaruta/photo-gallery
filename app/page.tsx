"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import FilterBar, { FilterValues } from "./components/FilterBar";
import LocaleToggle from "./components/LocaleToggle";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import { getLabels } from "./i18n/labels";

type Photo = {
  id: string;
  src: string;
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  date?: string;
  likes?: number;
};

const RAW_PHOTOS: Photo[] = [
  { id: "1", src: "/images/sample1.jpg", title: "Center of Attention", category: "nature", tags: ["nature", "flower"], date: "2024-01-10", likes: 10 },
  { id: "2", src: "/images/sample2.jpg", title: "The Heavens", category: "landscape", tags: ["landscape"], date: "2023-12-01", likes: 25 },
  { id: "3", src: "/images/sample3.jpg", title: "Dazzling", category: "architecture", tags: ["architecture"], date: "2024-02-02", likes: 5 },
];

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
  const closeRef = useRef<HTMLButtonElement | null>(null);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (currentIndex === null) return;
      if (e.key === "ArrowRight") showNext();
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "Escape") setCurrentIndex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentIndex, showNext, showPrev]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    if (currentIndex !== null) {
      document.body.style.overflow = "hidden";
      setTimeout(() => closeRef.current?.focus(), 0);
    } else {
      document.body.style.overflow = prev;
    }
    return () => {
      document.body.style.overflow = prev;
    };
  }, [currentIndex]);

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
    <main className="min-h-screen text-white bg-black">
      <div className="px-2 sm:px-4 md:px-6 py-5 max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h1 id="site-title" className="text-lg sm:text-2xl md:text-3xl font-bold leading-tight">
              {labels.site?.title ?? "Gallery"}
            </h1>
            {labels.site?.subtitle ? (
              <p id="site-subtitle" className="text-[12px] sm:text-sm md:text-base text-white/60 mt-1">
                {labels.site.subtitle}
              </p>
            ) : null}
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
          onChange={(next) => setFilters((s) => ({ ...s, ...next }))}
          className="mb-3"
          locale={locale}
          categoryDisplayMap={categoryDisplayMap}
        />

        <div className="mb-2 text-[12px] sm:text-sm text-white/70">結果: {filteredPhotos.length} 件</div>

        {/* Instagram-like: mobile 3 columns, gap-0; text sizes smaller on mobile */}
        <div className="grid grid-cols-3 gap-0 sm:grid-cols-3 md:grid-cols-4">
          {filteredPhotos.map((p, idx) => (
            <div key={p.id} className="w-full">
              <button
                onClick={() => open(idx)}
                className="w-full block p-0 border-0 bg-transparent focus:outline-none"
                aria-label={`Open ${p.title}`}
                style={{ touchAction: "manipulation" }}
              >
                <div className="relative w-full overflow-hidden" style={{ paddingTop: "75%" }}>
                  <Image
                    src={p.src}
                    alt={p.title}
                    fill
                    className="object-cover"
                    style={{ objectPosition: "50% 40%" }}
                    sizes="36vw"
                    loading="lazy"
                  />
                </div>
              </button>

              <div className="bg-[#111111] px-2 py-1">
                <div className="text-[12px] sm:text-sm font-semibold truncate">{p.title}</div>
                <div className="text-[10px] sm:text-xs text-white/60 truncate">{categoryDisplayMap[p.category ?? ""]}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {currentIndex !== null && filteredPhotos[currentIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={filteredPhotos[currentIndex].title}
          onClick={() => setCurrentIndex(null)}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.92)", padding: 12 }}
        >
          <div onClick={(e) => e.stopPropagation()} className="relative w-full mx-4" style={{ maxWidth: 980 }}>
            <div className="relative w-full" style={{ paddingTop: "66.66%", background: "#000" }}>
              <Image
                src={filteredPhotos[currentIndex].src}
                alt={filteredPhotos[currentIndex].title}
                fill
                className="object-contain"
                sizes="90vw"
                priority
              />
            </div>

            <div className="mt-3 text-white/90">
              <div className="text-sm md:text-lg font-medium">{filteredPhotos[currentIndex].title}</div>
              <div className="text-[12px] md:text-sm text-white/60">
                {categoryDisplayMap[filteredPhotos[currentIndex].category ?? ""] ?? capitalize(filteredPhotos[currentIndex].category)}
              </div>
              {filteredPhotos[currentIndex].description && (
                <div className="mt-2 text-[12px] md:text-sm text-white/70">{filteredPhotos[currentIndex].description}</div>
              )}
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              showPrev();
            }}
            aria-label="Previous image"
            className="fixed left-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-white"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <ArrowLeftIcon className="h-6 w-6 text-white" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              showNext();
            }}
            aria-label="Next image"
            className="fixed right-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-white"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <ArrowRightIcon className="h-6 w-6 text-white" />
          </button>
        </div>
      )}
    </main>
  );
}
