// app/page.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeftIcon, ArrowRightIcon, XMarkIcon } from "@heroicons/react/24/solid";

type Photo = { id: string; src: string; title: string };

const PHOTOS: Photo[] = [
  { id: "1", src: "/images/sample1.jpg", title: "Mountains" },
  { id: "2", src: "/images/sample2.jpg", title: "City Night" },
  { id: "3", src: "/images/sample3.jpg", title: "Portrait A" },
];

export default function Page() {
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const open = useCallback((i: number) => setCurrentIndex(i), []);
  const showNext = useCallback(() => setCurrentIndex((i) => (i === null ? null : (i + 1) % PHOTOS.length)), []);
  const showPrev = useCallback(() => setCurrentIndex((i) => (i === null ? null : (i - 1 + PHOTOS.length) % PHOTOS.length)), []);

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

  return (
    <main className="p-8 min-h-screen bg-[#0b0b0b] text-white">
      <h1 className="text-3xl font-bold mb-6">Gallery</h1>

      {/* Grid */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {PHOTOS.map((p, idx) => (
          <div key={p.id}>
            <button
              onClick={() => open(idx)}
              aria-label={`Open ${p.title}`}
              className="block w-full p-0 border-0 bg-transparent cursor-pointer"
            >
              {/* Thumbnail 親に高さ（16:9）を与える */}
              <div className="relative w-full overflow-hidden bg-gray-800" style={{ paddingTop: "56.25%" }}>
                <Image
                  src={p.src}
                  alt={p.title}
                  fill
                  className="object-cover object-bottom"
                  sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                  loading="lazy"
                />
              </div>
            </button>

            <div className="mt-2 px-1">
              <div className="text-sm font-semibold">{p.title}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {currentIndex !== null && PHOTOS[currentIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={PHOTOS[currentIndex].title}
          onClick={() => setCurrentIndex(null)}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.85)", padding: 16 }}
        >
          <div onClick={(e) => e.stopPropagation()} className="relative mx-4" style={{ width: "90vw", maxWidth: 900 }}>
            {/* モーダル内の親に高さを与え（4:3） */}
            <div className="relative w-full overflow-hidden bg-black" style={{ paddingTop: "75%" }}>
              <Image
                src={PHOTOS[currentIndex].src}
                alt={PHOTOS[currentIndex].title}
                fill
                className="object-cover object-bottom"
                sizes="90vw"
                priority
              />
            </div>

          </div>

          {/* Prev */}
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

          {/* Next */}
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
