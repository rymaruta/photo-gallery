// lib/hooks/useImagePreloader.ts
// 画像のプリロード機能用のカスタムフック

import { useRef, useMemo } from "react";
import { log } from "../utils/log";

/**
 * 画像をプリロードする
 */
export function preloadImage(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // 既にキャッシュされているかチェック
        const img = new Image();
        
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
        
        img.src = src;
    });
}

/**
 * 複数の画像をプリロードする
 */
export function preloadImages(srcs: string[]): Promise<void[]> {
    return Promise.all(srcs.map(src => preloadImage(src).catch(() => {
        // エラーが発生しても他の画像のプリロードは続行
        log.warn(`Failed to preload image: ${src}`);
    })));
}

/**
 * 画像プリロード用のカスタムフック
 */
export function useImagePreloader() {
    const preloadedRef = useRef<Set<string>>(new Set());
    
    // useMemoで関数を一度だけ作成（refsに依存しない）
    const preload = useMemo(() => {
        return (src: string) => {
            if (preloadedRef.current.has(src)) {
                return; // 既にプリロード済み
            }

            preloadedRef.current.add(src);
            
            // link rel="preload"を使用してブラウザにプリロードを指示
            const link = document.createElement("link");
            link.rel = "preload";
            link.as = "image";
            link.href = src;
            document.head.appendChild(link);

            // 画像オブジェクトでもプリロード（二重の保険）
            preloadImage(src).catch(() => {
                // エラーは無視（既にlink rel="preload"で試みている）
            });
        };
    }, []);

    const preloadMultiple = useMemo(() => {
        return (srcs: string[]) => {
            srcs.forEach(src => {
                if (!preloadedRef.current.has(src)) {
                    preload(src);
                }
            });
        };
    }, [preload]);

    return { preload, preloadMultiple };
}
