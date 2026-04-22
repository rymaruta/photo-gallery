import { useState, useEffect, useCallback } from "react";
import { storageGet, storageSet } from "../utils/storage";

const STORAGE_KEY = "photo-gallery-favorites";
const CHANGE_EVENT = "favorites-updated";

export function useFavorites() {
    const [favorites, setFavorites] = useState<string[]>([]);

    const load = useCallback(() => {
        setFavorites(storageGet<string[]>(STORAGE_KEY) ?? []);
    }, []);

    useEffect(() => {
        load();
        window.addEventListener(CHANGE_EVENT, load);
        return () => window.removeEventListener(CHANGE_EVENT, load);
    }, [load]);

    const save = useCallback((next: string[]) => {
        storageSet(STORAGE_KEY, next);
        setFavorites(next);
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    }, []);

    const isFavorite = useCallback(
        (photoId: string) => favorites.includes(photoId),
        [favorites]
    );

    // Always reads from storage to avoid stale-closure issues.
    const toggleFavorite = useCallback((photoId: string) => {
        const current = storageGet<string[]>(STORAGE_KEY) ?? [];
        save(
            current.includes(photoId)
                ? current.filter((id) => id !== photoId)
                : [...current, photoId]
        );
    }, [save]);

    const clearFavorites = useCallback(() => save([]), [save]);

    return { favorites, isFavorite, toggleFavorite, clearFavorites };
}
