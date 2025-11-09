// app/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import FilterBar, { FilterValues } from "./components/FilterBar";
import { ArrowLeftIcon, ArrowRightIcon, XMarkIcon } from "@heroicons/react/24/solid";
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
  { id: "2", src: "/images/sample2.jpg", title: "The Heavens", category: "landscape", tags: ["landscape", "mountain"], date: "2023-12-01", likes: 25 },
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
    <main className="p-8 min-h-screen bg-[#0b0b0b] text-white">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">Gallery</h1>
          <div className="text-sm text-white/60 mt-1">{labels.category.title}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setLocale("ja")} className={`px-3 py-1 rounded ${locale === "ja" ? "bg-white text-black" : "bg-white/5 text-white/80"}`} aria-pressed={locale === "ja"}>日本語</button>
          <button onClick={() => setLocale("en")} className={`px-3 py-1 rounded ${locale === "en" ? "bg-white text-black" : "bg-white/5 text-white/80"}`} aria-pressed={locale === "en"}>English</button>
        </div>
      </div>

      <FilterBar
        categories={categories}
        tags={tags}
        values={filters}
        onChange={(next) => setFilters((s) => ({ ...s, ...next }))}
        className="max-w-4xl mx-auto"
        locale={locale}
        categoryDisplayMap={categoryDisplayMap}
      />

      <div className="mb-4 text-sm text-white/70">結果: {filteredPhotos.length} 件</div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filteredPhotos.map((p, idx) => (
          <div key={p.id} className="w-full">
            <button onClick={() => open(idx)} className="block w-full p-0 border-0 bg-transparent cursor-pointer" aria-label={`Open ${p.title}`}>
              <div className="relative w-full overflow-hidden bg-gray-800" style={{ paddingTop: "56.25%" }}>
                <Image src={p.src} alt={p.title} fill className="object-cover object-bottom" sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw" loading="lazy" />
              </div>
            </button>

            {/* くっつける: mt-0 にして余白を無くす */}
            <div className="mt-0 w-full">
              <div className="bg-[#222222] px-3 py-1 text-left">
                <div className="text-sm font-semibold text-white leading-tight">{p.title}</div>
                <div className="text-xs text-white/60 mt-1">{categoryDisplayMap[p.category ?? ""]}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {currentIndex !== null && filteredPhotos[currentIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={filteredPhotos[currentIndex].title}
          onClick={() => setCurrentIndex(null)}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.85)", padding: 16 }}
        >
          <div onClick={(e) => e.stopPropagation()} className="relative mx-4 w-full" style={{ maxWidth: 900 }}>
            <div className="relative w-full overflow-hidden bg-black" style={{ paddingTop: "75%" }}>
              <Image
                src={filteredPhotos[currentIndex].src}
                alt={filteredPhotos[currentIndex].title}
                fill
                className="object-cover object-bottom"
                sizes="90vw"
                priority
              />
            </div>

            <div className="mt-3 text-white/80">
              <div className="text-lg font-medium">{filteredPhotos[currentIndex].title}</div>
              <div className="text-sm text-white/60">
                {categoryDisplayMap[filteredPhotos[currentIndex].category ?? ""] ?? capitalize(filteredPhotos[currentIndex].category)}
              </div>
              {filteredPhotos[currentIndex].description && (
                <div className="mt-2 text-sm text-white/70">{filteredPhotos[currentIndex].description}</div>
              )}
            </div>

          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              showPrev();
            }}
            aria-label="Previous image"
            className="fixed left-4 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-white"
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
            className="fixed right-4 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-white"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <ArrowRightIcon className="h-6 w-6 text-white" />
          </button>
        </div>
      )}
    </main>
  );
}
