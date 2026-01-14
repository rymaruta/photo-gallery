import React from "react";
import Image from "next/image";
import type { Photo, Locale } from "../data/photos";
import { getLocalized } from "../data/photos";
import { getLabels } from "../i18n/labels";

type Props = {
    photos: Photo[];
    onOpen: (index: number) => void;
    locale: Locale;
    categoryDisplayMap?: Record<string, string>;
};

export default function GalleryGrid({
    photos,
    onOpen,
    locale,
    categoryDisplayMap = {},
}: Props) {
    const labels = React.useMemo(() => getLabels(locale), [locale]);
    const emptyMessage = labels.gallery?.emptyMessage ?? (locale === "en" ? "No photos found." : "該当する写真がありません。");

    if (!photos || photos.length === 0) {
        return <div className="text-sm text-white/70">{emptyMessage}</div>;
    }

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-0">
            {photos.map((p, idx) => {
                const localizedTitle = getLocalized(p.title, locale) || (typeof p.title === "string" ? p.title : "");
                const localizedAlt = getLocalized(p.alt, locale) || localizedTitle || "";
                const placeholderColor = p.dominantColor ?? "#111";
                const objectPosition =
                    p.focalPoint ? `${Math.round(p.focalPoint.x * 100)}% ${Math.round(p.focalPoint.y * 100)}%` : undefined;

                return (
                    <div key={p.id} className="w-full m-0 p-0">
                        <button
                            onClick={() => onOpen(idx)}
                            className="block w-full p-0 border-0 bg-transparent cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                            aria-label={localizedTitle ? `Open ${localizedTitle}` : "Open photo"}
                            title={localizedTitle}
                            // touchAction はそのまま、iOS のタップハイライトを消す
                            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
                            data-photo-id={p.id}
                        >
                            <div
                                className="relative w-full overflow-hidden"
                                style={{ paddingTop: "75%", backgroundColor: placeholderColor, fontSize: 0, lineHeight: 0 }}
                            >
                                <div className="absolute inset-0" aria-hidden />

                                <Image
                                    src={p.src}
                                    alt={localizedAlt}
                                    fill
                                    className="object-cover"
                                    sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                                    loading="lazy"
                                    style={objectPosition ? { objectPosition } : undefined}
                                    priority={false}
                                />

                                <div
                                    className="absolute left-0 right-0 bottom-0 px-2"
                                    style={{
                                        background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%)",
                                    }}
                                >
                                    <div className="py-1 sm:py-2">
                                        <div
                                            className="text-sm font-semibold text-white truncate"
                                            title={localizedTitle}
                                        >
                                            {localizedTitle}
                                        </div>
                                        <div
                                            className="text-xs text-white/60 truncate"
                                            title={categoryDisplayMap[p.category ?? ""] || ""}
                                        >
                                            {categoryDisplayMap[p.category ?? ""]}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
