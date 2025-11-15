// app/components/GalleryModal.tsx
import React, { useEffect } from "react";
import Image from "next/image";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import type { Photo } from "../data/photos";

type Props = {
    photos: Photo[];
    currentIndex: number;
    onClose: () => void;
    onNext: () => void;
    onPrev: () => void;
    categoryDisplayMap?: Record<string, string>;
};

export default function GalleryModal({
    photos,
    currentIndex,
    onClose,
    onNext,
    onPrev,
    categoryDisplayMap = {},
}: Props) {
    const p = photos[currentIndex];

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") onNext();
            if (e.key === "ArrowLeft") onPrev();
            if (e.key === "Escape") onClose();
        };
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [onClose, onNext, onPrev]);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={p.title}
            onClick={onClose}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.9)", padding: 12 }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative mx-4 w-full"
                style={{ maxWidth: 980 }}
            >
                <div
                    className="relative w-full overflow-hidden bg-black"
                    style={{ paddingTop: "66.66%", fontSize: 0, lineHeight: 0 }}
                >
                    <Image
                        src={p.src}
                        alt={p.title}
                        fill
                        className="object-contain block"
                        sizes="90vw"
                        priority
                    />
                </div>

                {/* 丸いナビボタン（左） */}
                <div className="absolute top-1/2 left-3 transform -translate-y-1/2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onPrev();
                        }}
                        aria-label="Previous"
                        className="p-3 rounded-full bg-white/6 hover:bg-white/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shadow-lg"
                        style={{ backdropFilter: "blur(4px)" }}
                    >
                        <ArrowLeftIcon className="w-5 h-5 text-white" />
                    </button>
                </div>

                {/* 丸いナビボタン（右） */}
                <div className="absolute top-1/2 right-3 transform -translate-y-1/2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onNext();
                        }}
                        aria-label="Next"
                        className="p-3 rounded-full bg-white/6 hover:bg-white/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shadow-lg"
                        style={{ backdropFilter: "blur(4px)" }}
                    >
                        <ArrowRightIcon className="w-5 h-5 text-white" />
                    </button>
                </div>

                {/* メタ */}
                <div className="mt-3 text-white/90">
                    <div className="text-lg font-medium">{p.title}</div>
                    <div className="text-sm text-white/60">
                        {categoryDisplayMap[p.category ?? ""] ?? p.category}
                    </div>
                    {p.description && <div className="mt-2 text-sm text-white/70">{p.description}</div>}
                </div>
            </div>
        </div>
    );
}
