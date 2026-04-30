import { useState, useCallback } from "react";
import { storageGet, storageSet } from "../utils/storage";

const STORAGE_KEY = "photo-gallery-view-history";
const MAX_ITEMS = 50;

export type ViewHistoryItem = {
    photoId: string;
    viewedAt: string; // ISO 8601
};

function sortByDate(items: ViewHistoryItem[]): ViewHistoryItem[] {
    return [...items].sort(
        (a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime()
    );
}

export function useViewHistory() {
    const [history, setHistory] = useState<ViewHistoryItem[]>(() => {
        if (typeof window === "undefined") return [];
        return sortByDate(storageGet<ViewHistoryItem[]>(STORAGE_KEY) ?? []);
    });

    const saveHistory = useCallback((items: ViewHistoryItem[]) => {
        const sorted = sortByDate(items).slice(0, MAX_ITEMS);
        storageSet(STORAGE_KEY, sorted);
        setHistory(sorted);
    }, []);

    // Reads from storage to avoid stale-closure issues.
    const addToHistory = useCallback((photoId: string) => {
        const current = storageGet<ViewHistoryItem[]>(STORAGE_KEY) ?? [];
        const without = current.filter((item) => item.photoId !== photoId);
        saveHistory([{ photoId, viewedAt: new Date().toISOString() }, ...without]);
    }, [saveHistory]);

    const removeFromHistory = useCallback((photoId: string) => {
        const current = storageGet<ViewHistoryItem[]>(STORAGE_KEY) ?? [];
        saveHistory(current.filter((item) => item.photoId !== photoId));
    }, [saveHistory]);

    const clearHistory = useCallback(() => saveHistory([]), [saveHistory]);

    return { history, addToHistory, removeFromHistory, clearHistory };
}
