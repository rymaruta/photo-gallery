// app/components/GalleryGrid.tsx
import React from "react";
import Image from "next/image";
import type { Photo } from "../data/photos";

type Props = {
    photos: Photo[];
    onOpen: (index: number) => void;
    categoryDisplayMap?: Record<string, string>;
};

export default function GalleryGrid({ photos, onOpen, categoryDisplayMap = {} }: Props) {
    if (!photos || photos.length === 0) {
        return <div className="text-sm text-white/70">該当する写真がありません。</div>;
    }

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-0">
            {photos.map((p, idx) => (
                <div key={p.id} className="w-full m-0 p-0">
                    <button
                        onClick={() => {
                            console.log("GalleryGrid: open()", idx, p.id);
                            onOpen(idx);
                        }}
                        className="block w-full p-0 border-0 bg-transparent cursor-pointer"
                        aria-label={`Open ${p.title}`}
                        title={p.title}
                        style={{ touchAction: "manipulation" }}
                    >
                        <div className="relative w-full overflow-hidden" style={{ paddingTop: "75%", fontSize: 0, lineHeight: 0 }}>
                            <Image
                                src={p.src}
                                alt={p.title}
                                fill
                                className="object-cover block"
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
    );
}
