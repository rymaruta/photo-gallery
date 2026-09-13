// lib/hooks/useImagePreloader.ts
// 画像のプリロード機能用のカスタムフック

import { useRef, useCallback } from "react";
import { log } from "../utils/log";
import { publicImageUrl } from "../utils/seo";

/**
 * Image オブジェクトで画像をプリロードしてブラウザキャッシュに保存する。
 * link rel="preload" は毎回 DOM 要素を追加して蓄積するため使わない。
 *
 * **先読みするURLは、画面に出すURLと同じでなければ意味がない**
 * （`publicImageUrl`）。保存されている値は CloudFront の既定ドメインで、
 * 描く側（`Thumb` / `ModalImage`）はサイトのドメインに揃える。ここだけ
 * 生のまま先読みすると **同じ写真を別々のURLで2回落とす**
 * ——ブラウザのキャッシュは当たらず、Service Worker の写真の控えも
 * 80件の枠を2つ食う。**先読みは節約のための仕組みなのに、逆に倍払う。**
 * 呼ぶ側4か所ではなくここで揃える（`Thumb` と同じ「部品の中に置く」）。
 */
export function preloadImage(src: string): Promise<void> {
    const url = publicImageUrl(src);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.src = url;
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
        // **札も揃えたあとの値で持つ。** 生の値で覚えると、呼ぶ側が
        // 揃えた値を渡した日に「別のURL」として二重に先読みする
        const key = publicImageUrl(src);
        if (preloadedRef.current.has(key)) return;
        preloadedRef.current.add(key);

        preloadImage(src).catch(() => {
            log.warn(`Preload failed: ${src}`);
        });
    }, []);

    const preloadMultiple = useCallback((srcs: string[]) => {
        for (const src of srcs) preload(src);
    }, [preload]);

    return { preload, preloadMultiple };
}
