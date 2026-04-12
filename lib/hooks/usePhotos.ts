// lib/hooks/usePhotos.ts
// 写真一覧をAPIから取得する共通フック（AbortController対応）

import { useState, useEffect } from "react";
import type { Photo } from "../../app/data/photos";
import { log } from "../utils/log";

export function usePhotos() {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const controller = new AbortController();

        const load = async () => {
            try {
                const { publicFetch } = await import("../utils/api");
                const response = await publicFetch("/photos", {
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (response.ok) {
                    const data = await response.json() as Photo[];
                    setPhotos(data);
                } else {
                    log.error("写真の取得に失敗しました", { status: response.status });
                }
            } catch (error) {
                if ((error as { name?: string }).name !== "AbortError") {
                    log.error("写真取得エラー:", error);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        };

        void load();
        return () => controller.abort();
    }, []);

    return { photos, loading };
}
