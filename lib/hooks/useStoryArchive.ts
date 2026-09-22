"use client";

import { useCallback, useEffect, useState } from "react";
import { log } from "../utils/log";
import { usableRows } from "../utils/apiRows";
import type { Story } from "../stories";

/**
 * 自分のストーリーのアーカイブ（`GET /stories/archive`）を読む。
 *
 * `/user/archive`（見る）と `/user/highlights`（束ねる）が同じ一覧を
 * 同じ規則で読む——取得の失敗を「0件」に混ぜない・配列でない応答は失敗・
 * 行の形は `groupStories` が見る。
 *
 * @param enabled ログインが確定してから読む（未ログインで取りにいかない）
 */
export function useStoryArchive(enabled: boolean) {
    const [items, setItems] = useState<Story[] | null>(null);
    const [loadError, setLoadError] = useState(false);

    const load = useCallback(async () => {
        setLoadError(false);
        try {
            const { userFetch } = await import("../utils/api");
            const res = await userFetch("/stories/archive");
            if (!res.ok) {
                log.error("story archive fetch failed", { status: res.status });
                setLoadError(true);
                return;
            }
            const rows = usableRows<Story>(await res.json(), "GET /stories/archive");
            if (!rows) {
                log.error("story archive response is not an array");
                setLoadError(true);
                return;
            }
            setItems(rows);
        } catch (e) {
            log.error("story archive load error:", e);
            setLoadError(true);
        }
    }, []);

    useEffect(() => {
        if (enabled) void load();
    }, [enabled, load]);

    return { items, setItems, loadError, load };
}
