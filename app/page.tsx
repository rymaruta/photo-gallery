"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowRightIcon, ArrowLeftIcon, XMarkIcon } from "@heroicons/react/24/solid";

export default function Gallery() {
  const images = ["/images/sample1.jpg", "/images/sample2.jpg", "/images/sample3.jpg"];
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);

  const showNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentIndex !== null) {
      setCurrentIndex((currentIndex + 1) % images.length);
    }
  };

  const showPrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentIndex !== null) {
      setCurrentIndex((currentIndex - 1 + images.length) % images.length);
    }
  };

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-6">My Photo Gallery</h1>

      {/* ギャラリー */}
      <div className="grid grid-cols-3 gap-4">
        {images.map((src, idx) => (
          <Image
            key={idx}
            src={src}
            alt={`Sample ${idx + 1}`}
            width={300}
            height={200}
            className="rounded-lg shadow-lg hover:scale-105 transition cursor-pointer"
            onClick={() => setCurrentIndex(idx)}
          />
        ))}
      </div>

      {/* モーダル */}
      {currentIndex !== null && (
        <div
          className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50"
          onClick={() => setCurrentIndex(null)}
        >
          <div className="relative flex items-center">
            {/* ← ボタン */}
            <button
              className="absolute left-4 bg-black/40 rounded-full p-2 hover:bg-black/60"
              onClick={showPrev}
            >
              <ArrowLeftIcon className="h-8 w-8 text-white" />
            </button>

            {/* 画像 */}
            <Image
              src={images[currentIndex]}
              alt="Enlarged"
              width={800}
              height={600}
              className="rounded-lg"
            />

            {/* → ボタン */}
            <button
              className="absolute right-4 bg-black/40 rounded-full p-2 hover:bg-black/60"
              onClick={showNext}
            >
              <ArrowRightIcon className="h-8 w-8 text-white" />
            </button>

            {/* ✕ 閉じる（Heroicons版） */}
            <button
              className="absolute top-2 right-2 bg-black/40 rounded-full p-2 hover:bg-black/60"
              onClick={() => setCurrentIndex(null)}
            >
              <XMarkIcon className="h-8 w-8 text-white" />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
