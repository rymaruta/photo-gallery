"use client";

// app/components/SpotRows.tsx
//
// ほかの撮影スポットの一覧の行（印 → 名前・地域 → 距離 → 矢印）。撮影地ページ（近くの・同じ県の）と、
// 写真ページの「近くの撮影スポット」（2026-10-22）で共用する。`SpotGuideClient` から切り出した
// （写真ページが撮影地ページの部品を丸ごと読み込まないように）。

import React from "react";
import Link from "next/link";
import { MapPinIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { distanceLabel } from "@/lib/utils/journey";

/** 一覧の1行（`km` はこのスポットからの距離・両方に座標があるときだけ） */
export type SpotRow = { slug: string; name: string; region?: string; km?: number };

/**
 * ほかのスポットの一覧（iOS の `nearbyRow`: 面の箱に、印 → 名前 → 距離 → 矢印）。
 * **距離は計算したもの**（言い方は `distanceLabel`＝iOS の `NearbyPhotos.label` と同じ刻み）。
 * 地域の行は Web だけ残す（同じ県の一覧で市の違いが分かる）
 */
export default function SpotRows({ rows, isJa }: { rows: SpotRow[]; isJa: boolean }) {
    return (
        <ul className="m-0 p-0 rounded-2xl bg-surface overflow-hidden" style={{ listStyle: "none" }}>
            {rows.map((n, i) => {
                const dist = n.km === undefined ? "" : distanceLabel(n.km, isJa);
                return (
                    <li key={n.slug} className={i > 0 ? "border-t border-white/5" : undefined}>
                        <Link href={`/spots/${n.slug}`} prefetch={false}
                              className="flex items-center gap-3 px-3.5 hover:bg-surface-2 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                              style={{ minHeight: 54 }}>
                            <MapPinIcon className="w-5 h-5 flex-shrink-0 text-white/55" aria-hidden />
                            <span className="min-w-0 flex-1 py-2">
                                <span className="block text-white truncate" style={{ fontSize: "15px", lineHeight: "20px" }}>{n.name}</span>
                                {n.region && <span className="block text-white/55 truncate" style={{ fontSize: "12px", lineHeight: "15px" }}>{n.region}</span>}
                            </span>
                            {dist && <span className="flex-shrink-0 text-white/55" style={{ fontSize: "13px" }}>{dist}</span>}
                            <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0 text-white/55" aria-hidden />
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}

