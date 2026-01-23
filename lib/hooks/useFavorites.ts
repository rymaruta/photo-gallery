// lib/hooks/useFavorites.ts
// お気に入り機能用のカスタムフック

import { useState, useEffect, useCallback } from "react";

const FAVORITES_STORAGE_KEY = "photo-gallery-favorites";

export function useFavorites() {
    const [favorites, setFavorites] = useState<string[]>([]);

    // ローカルストレージからお気に入りを読み込む関数
    const loadFavorites = useCallback(() => {
        try {
            const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as string[];
                setFavorites(parsed);
            } else {
                setFavorites([]);
            }
        } catch (error) {
            console.error("Failed to load favorites:", error);
            setFavorites([]);
        }
    }, []);

    // ローカルストレージからお気に入りを読み込み
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadFavorites();
    }, [loadFavorites]);

    // お気に入りを保存
    const saveFavorites = useCallback((newFavorites: string[]) => {
        try {
            localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(newFavorites));
            setFavorites(newFavorites);
        } catch (error) {
            console.error("Failed to save favorites:", error);
        }
    }, []);

    // お気に入りかどうかをチェック
    const isFavorite = useCallback(
        (photoId: string) => {
            return favorites.includes(photoId);
        },
        [favorites]
    );

    // お気に入りの追加/削除を切り替え
    const toggleFavorite = useCallback(
        (photoId: string) => {
            try {
                // 常に最新のローカルストレージから読み込む（ステートに依存しない）
                const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
                let currentFavorites: string[] = [];
                
                if (stored) {
                    try {
                        currentFavorites = JSON.parse(stored) as string[];
                    } catch (e) {
                        console.error("Failed to parse stored favorites:", e);
                        currentFavorites = [];
                    }
                }
                
                // 既にお気に入りにある場合は削除、ない場合は追加
                const updated = currentFavorites.includes(photoId)
                    ? currentFavorites.filter(id => id !== photoId)
                    : [...currentFavorites, photoId];
                
                // ローカルストレージに保存
                localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(updated));
                
                // ステートも更新
                setFavorites(updated);
            } catch (error) {
                console.error("Failed to toggle favorite:", error);
            }
        },
        []
    );

    // お気に入りをクリア
    const clearFavorites = useCallback(() => {
        saveFavorites([]);
    }, [saveFavorites]);

    return {
        favorites,
        isFavorite,
        toggleFavorite,
        clearFavorites,
    };
}
