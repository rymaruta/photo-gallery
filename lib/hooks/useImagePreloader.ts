// lib/hooks/useImagePreloader.ts
// 画像のプリロード機能用のカスタムフック

import { useRef, useCallback } from "react";
import { log } from "../utils/log";

/**
 * Image オブジェクトで画像をプリロードしてブラウザキャッシュに保存する。
 * link rel="preload" は毎回 DOM 要素を追加して蓄積するため使わない。
 */
export function preloadImage(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
        img.src = src;
    });
}

/**
 * 複数の画像をプリロードする（失敗しても他は続行）
 */
export function preloadImages(srcs: string[]): Promise<void[]> {
    return Promise.all(
        srcs.map((src) =>
            preloadImage(src).catch(() => {
                log.warn(`Failed to preload image: ${src}`);
            })
        )
    );
}

/**
 * 画像プリロード用のカスタムフック。
 * 同一 URL は一度だけプリロードする（重複防止）。
 */
export function useImagePreloader() {
    const preloadedRef = useRef<Set<string>>(new Set());

    const preload = useCallback((src: string) => {
        if (preloadedRef.current.has(src)) return;
        preloadedRef.current.add(src);

        preloadImage(src).catch(() => {
            preloadedRef.current.delete(src);
            log.warn(`Preload failed, will retry on next access: ${src}`);
        });
    }, []);

    const preloadMultiple = useCallback((srcs: string[]) => {
        for (const src of srcs) preload(src);
    }, [preload]);

    return { preload, preloadMultiple };
}
