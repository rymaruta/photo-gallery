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
import { CARD_LIST, ROW, ROW_ICON_BOX, ROW_ICON, ROW_TITLE, ROW_SUB, ROW_VALUE, ROW_CHEVRON } from "./rowStyles";

/** 一覧の1行（`km` はこのスポットからの距離・両方に座標があるときだけ） */
export type SpotRow = { slug: string; name: string; region?: string; km?: number };

/**
 * ほかのスポットの一覧（iOS の `nearbyRow`: 面の箱に、印 → 名前 → 距離 → 矢印）。
 * **距離は計算したもの**（言い方は `distanceLabel`＝iOS の `NearbyPhotos.label` と同じ刻み）。
 * 地域の行は Web だけ残す（同じ県の一覧で市の違いが分かる）
 */
export default function SpotRows({ rows, isJa }: { rows: SpotRow[]; isJa: boolean }) {
    // 2026-10-30 束 0b C11: 共通の札と行（`rowStyles.ts`・行 56・白8%の縁・角 16・印 28・題 15 semibold・副 12）
    return (
        <ul className={CARD_LIST} style={{ listStyle: "none" }}>
            {rows.map((n) => {
                const dist = n.km === undefined ? "" : distanceLabel(n.km, isJa);
                return (
                    <li key={n.slug}>
                        <Link href={`/spots/${n.slug}`} prefetch={false} className={ROW}>
                            <span className={ROW_ICON_BOX}><MapPinIcon className={ROW_ICON} aria-hidden /></span>
                            <span className="min-w-0 flex-1 py-2">
                                <span className={ROW_TITLE}>{n.name}</span>
                                {n.region && <span className={ROW_SUB}>{n.region}</span>}
                            </span>
                            {dist && <span className={ROW_VALUE}>{dist}</span>}
                            <ChevronRightIcon className={ROW_CHEVRON} aria-hidden />
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}
