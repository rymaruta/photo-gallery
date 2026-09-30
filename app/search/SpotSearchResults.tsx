"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRightIcon, MapPinIcon } from "@heroicons/react/24/outline";
import { ROUTES } from "@/lib/routes";
import { searchSpotRows, type SpotSearchRow } from "@/lib/utils/spots";

/**
 * **「さがす」の撮影スポットの結果。** 写真の結果とは別の節で、件数も混ぜない。
 *
 * 2026-09-30 のレビュー:「探す」で「銀山温泉」を検索すると写真0件になり、
 * 撮影地ガイドは存在するのに検索結果から案内されない。写真が0枚でも、
 * 撮影地のガイドから目的地を選べるようにする（投稿が少ない今こそ要る）。
 *
 * ## 取りに行くのは、語を打ったときだけ
 *
 * 名前だけの索引（`/app/data/spot-search.json`・約 130KB／gzip 約 70KB）は、
 * **最初に語が入ったとき1回だけ**取る。ページに埋め込むと、探さない人まで毎回受け取る。
 * 取れなかったら節ごと出さない（写真の結果はそのまま使える）。
 *
 * ## 出さないもの
 *
 * 写真の枚数・人気・評価は出さない（台帳は数を持たない。`MapSpotList` と同じ方針）。
 */

/** 最初に見せる件数。「県の名前」で当てると数十件になるので、畳んでおく */
const INITIAL = 5;

let cache: Promise<SpotSearchRow[] | null> | null = null;
/** 試験用（モジュールの控えを捨てる） */
export function resetSpotSearchCache() { cache = null; }

function loadIndex(): Promise<SpotSearchRow[] | null> {
    if (!cache) {
        cache = fetch("/app/data/spot-search.json")
            .then((res) => (res.ok ? res.json() : null))
            .then((json) => (Array.isArray(json) ? (json as SpotSearchRow[]) : null))
            .catch(() => null)
            .then((rows) => {
                // 失敗は控えない（次に打ったとき取り直す）
                if (!rows) cache = null;
                return rows;
            });
    }
    return cache;
}

export default function SpotSearchResults({ query, locale }: { query: string; locale: "ja" | "en" | string }) {
    const en = locale === "en";
    const q = query.trim();
    const [rows, setRows] = useState<SpotSearchRow[] | null>(null);
    /** 開いた語。**語が変わったら自然に畳まれる**（effect で戻さない） */
    const [expandedFor, setExpandedFor] = useState<string | null>(null);
    const expanded = expandedFor === q;

    useEffect(() => {
        if (!q || rows) return;
        let alive = true;
        void loadIndex().then((r) => { if (alive && r) setRows(r); });
        return () => { alive = false; };
    }, [q, rows]);

    const hits = useMemo(() => (q && rows ? searchSpotRows(rows, q) : []), [rows, q]);
    if (!q || hits.length === 0) return null;
    const shown = expanded ? hits : hits.slice(0, INITIAL);

    return (
        <section aria-labelledby="search-spot-heading" className="mb-6" data-testid="search-spot-results">
            <h2 id="search-spot-heading" className="m-0 font-serif font-bold text-white"
                style={{ fontSize: "15px", lineHeight: "22px", marginBottom: "8px" }}>
                {en ? `Shooting spots (${hits.length})` : `撮影スポット（${hits.length}か所）`}
            </h2>
            <ul className="list-none m-0 p-0 rounded-2xl bg-surface overflow-hidden">
                {shown.map((s, i) => (
                    <li key={s.s} className={i > 0 ? "border-t border-white/5" : undefined}>
                        <Link href={`${ROUTES.SPOTS}/${s.s}`} prefetch={false}
                              className="flex items-center gap-3 px-3.5 hover:bg-surface-2 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                              style={{ minHeight: "56px" }}>
                            <MapPinIcon className="w-5 h-5 shrink-0 text-accent" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-white" style={{ fontSize: "15px", lineHeight: "22px" }}>{s.n}</span>
                                <span className="block truncate text-white/70" style={{ fontSize: "12px", lineHeight: "18px" }}>
                                    {en ? "Photo spot guide" : "撮影地ガイド"}{s.g ? ` ・ ${s.g}` : ""}
                                </span>
                            </span>
                            <ChevronRightIcon aria-hidden="true" className="shrink-0 text-white/50" style={{ width: "18px", height: "18px" }} />
                        </Link>
                    </li>
                ))}
            </ul>
            {hits.length > INITIAL && (
                <button type="button" onClick={() => setExpandedFor(expanded ? null : q)}
                        className="mt-2 rounded-full px-4 text-white/80 ring-1 ring-line hover:bg-white/10"
                        style={{ minHeight: "44px", fontSize: "13px" }}
                        aria-expanded={expanded}>
                    {expanded
                        ? (en ? "Show fewer" : "閉じる")
                        : (en ? `Show all ${hits.length}` : `すべて表示（${hits.length}か所）`)}
                </button>
            )}
        </section>
    );
}
