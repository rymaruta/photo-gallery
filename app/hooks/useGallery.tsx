// app/hooks/useGallery.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Photo, LocalizedText, LocalizedParagraphs } from "../data/photos";
import { getLocalized, getLocalizedParagraphs } from "../data/photos";
import type { GalleryFilters } from "../../lib/types/gallery";

const normalizeKey = (s?: string) => (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");

// safe ISO date parse helper — returns ISO string or empty
const toISO = (s?: string) => {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toISOString();
};

export default function useGallery(raw: Photo[]) {
    const PHOTOS = useMemo(
        () =>
            raw.map((p) => {
                const category = normalizeKey(p.category);
                const tags = (p.tags ?? []).map((t) => (t ?? "").toString().trim()).filter(Boolean);
                const date = p.date ?? p.createdAt ?? "";

                return {
                    ...p,
                    category,
                    tags,
                    date,
                };
            }),
        [raw]
    );

    const [filters, setFilters] = useState<GalleryFilters>({
        category: "all",
        selectedTags: [],
        query: "",
        sort: "new",
    });

    const [currentIndex, setCurrentIndex] = useState<number | null>(null);

    const filteredPhotos = useMemo(() => {
        let arr = PHOTOS.slice();

        if (filters.category !== "all") arr = arr.filter((p) => p.category === filters.category);
        if (filters.selectedTags.length)
            arr = arr.filter((p) => filters.selectedTags.every((t) => (p.tags || []).includes(t)));
        if (filters.query.trim()) {
            const q = filters.query.toLowerCase();
            arr = arr.filter((p) => {
                // title: localized join of ja & en
                const titleJa = typeof p.title === "string" ? p.title : getLocalized(p.title as LocalizedText, "ja");
                const titleEn = typeof p.title === "string" ? p.title : getLocalized(p.title as LocalizedText, "en");
                const title = `${titleJa} ${titleEn}`;

                // description: handle string | LocalizedParagraphs properly
                let descJa = "";
                let descEn = "";
                if (typeof p.description === "string") {
                    descJa = p.description;
                    descEn = p.description;
                } else {
                    const jaArr = getLocalizedParagraphs(p.description as LocalizedParagraphs, "ja");
                    const enArr = getLocalizedParagraphs(p.description as LocalizedParagraphs, "en");
                    descJa = jaArr.join(" ");
                    descEn = enArr.join(" ");
                }
                const desc = `${descJa} ${descEn}`;

                return (title + " " + desc).toLowerCase().includes(q);
            });
        }

        if (filters.sort === "new") {
            arr.sort((a, b) => {
                const ia = toISO(b.date);
                const ib = toISO(a.date);
                return ia.localeCompare(ib);
            });
        } else if (filters.sort === "old") {
            arr.sort((a, b) => {
                const ia = toISO(a.date);
                const ib = toISO(b.date);
                return ia.localeCompare(ib);
            });
        } else if (filters.sort === "popular") {
            arr.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
        }

        return arr;
    }, [filters, PHOTOS]);

    const open = useCallback(
        (i: number) => {
            setCurrentIndex(i >= 0 && i < filteredPhotos.length ? i : null);
        },
        [filteredPhotos.length]
    );

    const close = useCallback(() => setCurrentIndex(null), []);

    const next = useCallback(
        () =>
            setCurrentIndex((i) =>
                i === null ? null : filteredPhotos.length ? (i + 1) % filteredPhotos.length : null
            ),
        [filteredPhotos.length]
    );

    const prev = useCallback(
        () =>
            setCurrentIndex((i) =>
                i === null ? null : filteredPhotos.length ? (i - 1 + filteredPhotos.length) % filteredPhotos.length : null
            ),
        [filteredPhotos.length]
    );

    // NOTE: modal keyboard / body overflow side effects removed from hook.
    // Modal component should manage focus/overflow/keyboard to avoid duplication and race conditions.
    // If you want hook-driven modal side-effects, implement a shared counter + refs (similar to GalleryModal).
    useEffect(() => {
        // no-op; kept in case you want to add global side effects later
        return () => { };
    }, []);

    const updateFilters = useCallback((next: Partial<GalleryFilters>) => {
        setFilters((s) => ({ ...s, ...next }));
    }, []);

    return {
        PHOTOS,
        filters,
        setFilters: updateFilters,
        filteredPhotos,
        currentIndex,
        open,
        close,
        next,
        prev,
    } as const;
}
