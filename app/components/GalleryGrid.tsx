import React from "react";

type Photo = {
    id: string;
    title: string;
    description?: string;
    category: string;
    tags?: string[];
    src: string;
    date?: string;
    likes?: number;
};

export default function GalleryGrid({ photos }: { photos: Photo[] }) {
    if (!photos.length) {
        return <div className="text-sm text-white/70">該当する写真がありません。</div>;
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {photos.map((p) => (
                <figure key={p.id} className="bg-white/3 rounded overflow-hidden">
                    <img src={p.src} alt={p.title} className="w-full h-48 object-cover" loading="lazy" />
                    <figcaption className="p-2 text-sm text-white">
                        <div className="font-semibold">{p.title}</div>
                        <div className="text-xs text-white/70">{p.tags?.join(" · ")}</div>
                    </figcaption>
                </figure>
            ))}
        </div>
    );
}
