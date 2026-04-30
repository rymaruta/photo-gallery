// lib/hooks/usePhotos.ts
// 写真一覧をAPIから取得する共通フック（AbortController対応）

import { useState, useEffect } from "react";
import type { Photo } from "../data/photos";
import BASE_PHOTOS from "../data/photos";
import { log } from "../utils/log";

export function usePhotos() {
    // BASE_PHOTOSを初期値とすることで、APIが遅延・失敗しても即時コンテンツ表示を保証する
    const [photos, setPhotos] = useState<Photo[]>(BASE_PHOTOS);
    const loading = false;

    useEffect(() => {
        const controller = new AbortController();

        const load = async () => {
            try {
                const { publicFetch } = await import("../utils/api");
                const response = await publicFetch("/photos", {
                    signal: controller.signal,
                });
                if (response.ok) {
                    const data = await response.json() as Photo[];
                    setPhotos(data);
                } else {
                    log.warn("写真の取得に失敗しました", { status: response.status });
                }
            } catch (error) {
                if ((error as { name?: string }).name !== "AbortError") {
                    log.error("写真取得エラー:", error);
                }
            }
        };

        void load();
        return () => controller.abort();
    }, []);

    return { photos, loading };
}
