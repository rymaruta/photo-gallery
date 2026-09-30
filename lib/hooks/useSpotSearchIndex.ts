"use client";

import { useEffect, useState } from "react";
import type { SpotSearchRow } from "../utils/spots";

/**
 * **撮影スポットの名前だけの索引**（`/app/data/spot-search.json`）を、語が入ったときに1回だけ取る。
 *
 * 「さがす」の撮影スポットの節（`SpotSearchResults`）と、地図のスポットの絞り込みが
 * **同じ索引・同じ当て方**（`searchSpotRows`：名前・読み・英語名・別名・地域）を使うため。
 * 地図のピン（`SpotPin`）は名前と地域しか持たないので、索引が無いと「ぎんざん」「Ginzan」で
 * 地図だけ0件になっていた（2026-09-30 のレビュー）。
 *
 * - 成功した結果だけをモジュールに控える（ページ内で1回）。失敗は控えない
 * - 語が空のあいだは取りに行かない（探さない人に 130KB を配らない）
 */
let cache: Promise<SpotSearchRow[] | null> | null = null;

/** 試験用（モジュールの控えを捨てる） */
export function resetSpotSearchIndex() { cache = null; }

export function loadSpotSearchIndex(): Promise<SpotSearchRow[] | null> {
    if (!cache) {
        cache = fetch("/app/data/spot-search.json")
            .then((res) => (res.ok ? res.json() : null))
            .then((json) => (Array.isArray(json) ? (json as SpotSearchRow[]) : null))
            .catch(() => null)
            .then((rows) => {
                if (!rows) cache = null;
                return rows;
            });
    }
    return cache;
}

/**
 * 語が入っていれば索引を返す（届くまでは `rows: null`）。
 * `pending` は「語はあるが、索引を待っている」——失敗したらその語では待たない
 * （待ち続けると「探しています…」が消えない）
 */
export function useSpotSearchIndex(query: string): { rows: SpotSearchRow[] | null; pending: boolean } {
    const q = query.trim();
    const [rows, setRows] = useState<SpotSearchRow[] | null>(null);
    /** 取りに行って失敗した語（その語では待たない。打ち足せば取り直す） */
    const [failedFor, setFailedFor] = useState<string | null>(null);
    // **語が変わるたびに見直す**（失敗は控えないので、打ち足せば取り直す）。
    // 取れたあとは `rows` があるので何もしない
    useEffect(() => {
        if (!q || rows) return;
        let alive = true;
        void loadSpotSearchIndex().then((r) => {
            if (!alive) return;
            if (r) setRows(r); else setFailedFor(q);
        });
        return () => { alive = false; };
    }, [q, rows]);
    return { rows, pending: !!q && !rows && failedFor !== q };
}
