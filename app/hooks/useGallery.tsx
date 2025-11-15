// app/hooks/useGallery.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Photo } from "../data/photos";

export type GalleryFilters = {
    category: string;
    selectedTags: string[];
    query: string;
    sort: "new" | "old" | "popular";
};

const normalizeKey = (s?: string) => (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");

export default function useGallery(raw: Photo[]) {
    const PHOTOS = useMemo(
        () =>
            raw.map((p) => ({
                ...p,
                category: normalizeKey(p.category),
                tags: (p.tags ?? []).map((t) => (t ?? "").toString().trim()).filter(Boolean),
            })),
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
            arr = arr.filter((p) => ((p.title ?? "") + " " + (p.description ?? "")).toLowerCase().includes(q));
        }

        if (filters.sort === "new") arr.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
        else if (filters.sort === "old") arr.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
        else if (filters.sort === "popular") arr.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));

        return arr;
    }, [filters, PHOTOS]);

    const open = useCallback((i: number) => {
        setCurrentIndex(i >= 0 && i < filteredPhotos.length ? i : null);
    }, [filteredPhotos.length]);

    const close = useCallback(() => setCurrentIndex(null), []);

    const next = useCallback(
        () => setCurrentIndex((i) => (i === null ? null : (filteredPhotos.length ? (i + 1) % filteredPhotos.length : null))),
        [filteredPhotos.length]
    );

    const prev = useCallback(
        () => setCurrentIndex((i) => (i === null ? null : (filteredPhotos.length ? (i - 1 + filteredPhotos.length) % filteredPhotos.length : null))),
        [filteredPhotos.length]
    );

    // キーボード操作と body overflow 管理（モーダル専用副作用）
    useEffect(() => {
        if (currentIndex === null) return;

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") next();
            if (e.key === "ArrowLeft") prev();
            if (e.key === "Escape") close();
        };
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [currentIndex, next, prev, close]);

    // helper to partially update filters
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
