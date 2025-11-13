"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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

  // 追加したサンプル画像
  { id: "4", src: "/images/sample4.jpg", title: "Sunlit Blossom", category: "nature", tags: ["nature", "morning"], date: "2024-03-11", likes: 8 },
  { id: "5", src: "/images/sample5.jpg", title: "Twilight at Versailles", category: "landscape", tags: ["landscape"], date: "2023-11-20", likes: 18 },
  { id: "6", src: "/images/sample6.jpg", title: "Flare", category: "landscape", tags: ["landscape"], date: "2024-04-02", likes: 30 },
  { id: "7", src: "/images/sample7.jpg", title: "Line Up", category: "architecture", tags: ["rchitecture"], date: "2023-10-05", likes: 12 },
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

        {/* モーダル */}
        {currentIndex !== null && filteredPhotos[currentIndex] && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={filteredPhotos[currentIndex].title}
            onClick={() => setCurrentIndex(null)}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.9)", padding: 12 }}
          >
            {/* inner container: image wrapper and controls are positioned relative to this */}
            <div onClick={(e) => e.stopPropagation()} className="relative mx-4 w-full" style={{ maxWidth: 980 }}>
              {/* image wrapper: we keep this as the visual reference for nav alignment */}
              <div id="modal-image-wrapper" className="relative w-full overflow-hidden bg-black" style={{ paddingTop: "66.66%" }}>
                <Image src={filteredPhotos[currentIndex].src} alt={filteredPhotos[currentIndex].title} fill className="object-contain" sizes="90vw" priority />
              </div>

              {/* meta */}
              <div className="mt-3 text-white/90">
                <div className="text-lg font-medium">{filteredPhotos[currentIndex].title}</div>
                <div className="text-sm text-white/60">
                  {categoryDisplayMap[filteredPhotos[currentIndex].category ?? ""] ?? capitalize(filteredPhotos[currentIndex].category)}
                </div>
                {filteredPhotos[currentIndex].description && (
                  <div className="mt-2 text-sm text-white/70">{filteredPhotos[currentIndex].description}</div>
                )}
              </div>

              {/* NAV buttons: desktop -> outside image; mobile -> inside edge with safe margins */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  showPrev();
                }}
                aria-label="Previous image"
                className="absolute flex items-center justify-center bg-black/40 hover:bg-black/60 p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-white"
                style={{
                  top: `calc(50% - 0px)`,
                  left: 0,
                  transform: "translate(-140px, -50%)", // desktop: move 140px left of wrapper left edge
                  minWidth: 56,
                  minHeight: 56,
                  lineHeight: 0,
                  zIndex: 80,
                }}
              >
                <ArrowLeftIcon className="h-6 w-6 text-white" />
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  showNext();
                }}
                aria-label="Next image"
                className="absolute flex items-center justify-center bg-black/40 hover:bg-black/60 p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-white"
                style={{
                  top: `calc(50% - 0px)`,
                  right: 0,
                  transform: "translate(140px, -50%)", // desktop: move 140px right of wrapper right edge
                  minWidth: 56,
                  minHeight: 56,
                  lineHeight: 0,
                  zIndex: 80,
                }}
              >
                <ArrowRightIcon className="h-6 w-6 text-white" />
              </button>

              {/* Responsive rules: mobile bring nav inside image edge and reduce size to 44px with icon h-5 */}
              <style>{`
                @media (max-width: 840px) {
                  button[aria-label="Previous image"] {
                    transform: translate(12px, -50%) !important;
                    left: 12px !important; /* safe margin from left edge */
                    min-width: 44px !important;
                    min-height: 44px !important;
                  }
                  button[aria-label="Previous image"] svg { height: 20px !important; width: 20px !important; } /* h-5 */
                  button[aria-label="Next image"] {
                    transform: translate(-12px, -50%) !important;
                    right: 12px !important; /* safe margin from right edge */
                    min-width: 44px !important;
                    min-height: 44px !important;
                  }
                  button[aria-label="Next image"] svg { height: 20px !important; width: 20px !important; } /* h-5 */
                  /* ensure nav buttons are above the image and meta */
                  button[aria-label="Previous image"],
                  button[aria-label="Next image"] {
                    z-index: 95 !important;
                  }
                }
                @media (min-width: 841px) {
                  /* desktop: keep large nav (h-6, 56px) as set inline */
                }
              `}</style>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
