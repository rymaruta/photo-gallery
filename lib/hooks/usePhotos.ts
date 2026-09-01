// lib/hooks/usePhotos.ts
// 写真一覧をAPIから取得する共通フック（AbortController対応）

import { useState, useEffect } from "react";
import type { Photo } from "../data/photos";
import BASE_PHOTOS_JSON from "@/app/data/photos.json";
import { log } from "../utils/log";

const BASE_PHOTOS = BASE_PHOTOS_JSON as Photo[];

export function usePhotos() {
    // BASE_PHOTOSを初期値とすることで、APIが遅延・失敗しても即時コンテンツ表示を保証する
    const [photos, setPhotos] = useState<Photo[]>(BASE_PHOTOS);
    const loading = false;
    /**
     * **API の一覧で置き換わったか。**
     *
     * 初期値は `app/data/photos.json`（ビルド時のスナップショット）なので、
     * 「配列が空でない」は「一覧が届いた」の代わりにならない。それで代用して
     * いたせいで、ビルド後にアップロードされた写真の共有リンクに対して
     * 「その写真は見つかりませんでした」と**嘘をつき**、しかもその判定を
     * 覚えてしまって**あとから届いても開かなく**なっていた。
     *
     * **失敗したときは true にしない。** 取れなかっただけで「無い」とは
     * 言えないので、判断できないままにしておく（黙る側に倒す）。
     * 定期ビルドは止まっているので、静的JSONは日単位で古い。
     */
    const [loaded, setLoaded] = useState(false);

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
                    // APIが空配列を返した場合はBASE_PHOTOSを維持する
                    if (Array.isArray(data) && data.length > 0) {
                        setPhotos(data);
                        setLoaded(true);
                    }
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

    return { photos, loading, loaded };
}
