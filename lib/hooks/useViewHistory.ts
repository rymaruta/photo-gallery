// lib/hooks/useViewHistory.ts
// 閲覧履歴機能用のカスタムフック

import { useState, useEffect, useCallback } from "react";

const VIEW_HISTORY_STORAGE_KEY = "photo-gallery-view-history";
const MAX_HISTORY_ITEMS = 10; // 最大保存件数

export type ViewHistoryItem = {
    photoId: string;
    viewedAt: string; // ISO 8601形式の日時文字列
};

import { log } from "../utils/log";

export function useViewHistory() {
    const [history, setHistory] = useState<ViewHistoryItem[]>([]);

    // ローカルストレージから閲覧履歴を読み込む関数
    const loadHistory = useCallback(() => {
        try {
            const stored = localStorage.getItem(VIEW_HISTORY_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as ViewHistoryItem[];
                // 日時でソート（新しい順）
                const sorted = parsed.sort((a, b) => 
                    new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime()
                );
                setHistory(sorted);
            } else {
                setHistory([]);
            }
        } catch (error) {
            log.error("Failed to load view history:", error);
            setHistory([]);
        }
    }, []);

    // ローカルストレージから閲覧履歴を読み込み
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadHistory();
    }, [loadHistory]);

    // 閲覧履歴を保存
    const saveHistory = useCallback((newHistory: ViewHistoryItem[]) => {
        try {
            // 最大件数を超える場合は古いものを削除
            const trimmed = newHistory.slice(0, MAX_HISTORY_ITEMS);
            // 日時でソート（新しい順）
            const sorted = trimmed.sort((a, b) => 
                new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime()
            );
            localStorage.setItem(VIEW_HISTORY_STORAGE_KEY, JSON.stringify(sorted));
            setHistory(sorted);
        } catch (error) {
            log.error("Failed to save view history:", error);
        }
    }, []);

    // 画像を閲覧履歴に追加
    const addToHistory = useCallback(
        (photoId: string) => {
            try {
                const now = new Date().toISOString();
                
                // 常に最新のローカルストレージから読み込む（ステートに依存しない）
                const stored = localStorage.getItem(VIEW_HISTORY_STORAGE_KEY);
                let currentHistory: ViewHistoryItem[] = [];
                
                if (stored) {
                    try {
                        currentHistory = JSON.parse(stored) as ViewHistoryItem[];
                    } catch (e) {
                        log.error("Failed to parse stored history:", e);
                        currentHistory = [];
                    }
                }
                
                // 既に同じ画像が履歴にある場合は削除（重複を避ける）
                const filtered = currentHistory.filter(item => item.photoId !== photoId);
                
                // 新しい履歴を先頭に追加
                const updated = [{ photoId, viewedAt: now }, ...filtered];
                
                // 最大件数を超える場合は古いものを削除
                const trimmed = updated.slice(0, MAX_HISTORY_ITEMS);
                
                // 日時でソート（新しい順）
                const sorted = trimmed.sort((a, b) => 
                    new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime()
                );
                
                // ローカルストレージに保存
                localStorage.setItem(VIEW_HISTORY_STORAGE_KEY, JSON.stringify(sorted));
                
                // ステートも更新
                setHistory(sorted);
            } catch (error) {
                log.error("Failed to add to history:", error);
            }
        },
        []
    );

    // 閲覧履歴をクリア
    const clearHistory = useCallback(() => {
        saveHistory([]);
    }, [saveHistory]);

    // 特定の画像を履歴から削除
    const removeFromHistory = useCallback(
        (photoId: string) => {
            const filtered = history.filter(item => item.photoId !== photoId);
            saveHistory(filtered);
        },
        [history, saveHistory]
    );

    // 閲覧履歴の件数を取得
    const getHistoryCount = useCallback(() => {
        return history.length;
    }, [history]);

    return {
        history,
        addToHistory,
        clearHistory,
        removeFromHistory,
        getHistoryCount,
    };
}
