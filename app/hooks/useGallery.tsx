// app/hooks/useGallery.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function readFiltersFromUrl(): Partial<GalleryFilters> {
    if (typeof window === "undefined") return {};
    const params = new URLSearchParams(window.location.search);
    const out: Partial<GalleryFilters> = {};
    const cat = params.get("category");
    if (cat) out.category = cat;
    const q = params.get("q");
    if (q) out.query = q;
    const sort = params.get("sort");
    if (sort === "new" || sort === "old" || sort === "popular") out.sort = sort;
    const tags = params.get("tags");
    if (tags) out.selectedTags = tags.split(",").filter(Boolean);
    return out;
}

export default function useGallery(raw: Photo[]) {
    // ISO日付を正規化ステップで一度だけ計算（ソート時の繰り返しパースを回避）
    const PHOTOS = useMemo(
        () =>
            raw.map((p) => {
                const category = normalizeKey(p.category);
                const tags = (p.tags ?? []).map((t) => (t ?? "").toString().trim()).filter(Boolean);
                const date = p.date ?? p.createdAt ?? "";
                const _dateISO = toISO(date);

                return { ...p, category, tags, date, _dateISO };
            }),
        [raw]
    );

    // URL から初期フィルターを読み込む（マウント時一度だけ）
    const [filters, setFilters] = useState<GalleryFilters>(() => ({
        category: "all",
        selectedTags: [],
        query: "",
        sort: "new",
        ...readFiltersFromUrl(),
    }));

    const [currentIndex, setCurrentIndex] = useState<number | null>(null);

    // フィルターが変わるたびに URL を更新（pushせず replaceState で履歴を汚さない）
    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams();
        if (filters.category && filters.category !== "all") params.set("category", filters.category);
        if (filters.query) params.set("q", filters.query);
        if (filters.sort && filters.sort !== "new") params.set("sort", filters.sort);
        if (filters.selectedTags.length) params.set("tags", filters.selectedTags.join(","));
        const search = params.toString();
        window.history.replaceState({}, "", search ? `?${search}` : window.location.pathname);
    }, [filters]);

    const filteredPhotos = useMemo(() => {
        let arr = PHOTOS.slice();

        if (filters.category !== "all") arr = arr.filter((p) => p.category === filters.category);
        if (filters.selectedTags.length)
            arr = arr.filter((p) => filters.selectedTags.every((t) => (p.tags || []).includes(t)));
        if (filters.query.trim()) {
            const q = filters.query.toLowerCase();
            arr = arr.filter((p) => {
                const titleJa = typeof p.title === "string" ? p.title : getLocalized(p.title as LocalizedText, "ja");
                const titleEn = typeof p.title === "string" ? p.title : getLocalized(p.title as LocalizedText, "en");

                let descJa = "";
                let descEn = "";
                if (typeof p.description === "string") {
                    descJa = p.description;
                    descEn = p.description;
                } else {
                    descJa = getLocalizedParagraphs(p.description as LocalizedParagraphs, "ja").join(" ");
                    descEn = getLocalizedParagraphs(p.description as LocalizedParagraphs, "en").join(" ");
                }

                // location も検索対象に含める
                const loc = p.location ?? "";

                const haystack = `${titleJa} ${titleEn} ${descJa} ${descEn} ${loc}`.toLowerCase();
                return haystack.includes(q);
            });
        }

        // 事前計算済みの _dateISO を使ってソート（パースなし）
        if (filters.sort === "new") {
            arr.sort((a, b) => b._dateISO.localeCompare(a._dateISO));
        } else if (filters.sort === "old") {
            arr.sort((a, b) => a._dateISO.localeCompare(b._dateISO));
        } else if (filters.sort === "popular") {
            arr.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
        }

        return arr;
    }, [filters, PHOTOS]);

    // filteredPhotos を ref で追跡 → コールバックを安定させる
    const filteredPhotosRef = useRef(filteredPhotos);
    useEffect(() => {
        filteredPhotosRef.current = filteredPhotos;
    }, [filteredPhotos]);

    // 依存配列なし → 参照が変わらない安定したコールバック
    const open = useCallback((i: number) => {
        const len = filteredPhotosRef.current.length;
        setCurrentIndex(i >= 0 && i < len ? i : null);
    }, []);

    const close = useCallback(() => setCurrentIndex(null), []);

    const next = useCallback(() =>
        setCurrentIndex((i) => {
            const len = filteredPhotosRef.current.length;
            return i === null ? null : len ? (i + 1) % len : null;
        }), []);

    const prev = useCallback(() =>
        setCurrentIndex((i) => {
            const len = filteredPhotosRef.current.length;
            return i === null ? null : len ? (i - 1 + len) % len : null;
        }), []);

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
