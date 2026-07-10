"use client";

// マイランキングの表彰台カード。
// 上位3位は金・銀・銅のメダル + 高さの違う表彰台（2位→1位→3位の並び）、
// 4位以下はリスト行で表示する。プロフィールの目玉要素なので
// メタリックグラデーションと光沢スイープでリッチに見せる。

import React from "react";
import { TrophyIcon } from "@heroicons/react/24/solid";

type Props = {
    title?: string;
    items: string[];
    locale?: string;
    className?: string;
};

// 金・銀・銅のメタリック配色（index = 順位 - 1）
const METALS = [
    {
        disc: "bg-gradient-to-br from-amber-100 via-yellow-400 to-amber-600 text-amber-950",
        ring: "ring-2 ring-amber-200/70",
        glow: "shadow-[0_4px_24px_rgba(251,191,36,0.35)]",
        pedestal: "from-amber-300/40 via-amber-400/15 to-transparent",
        height: "h-16",
    },
    {
        disc: "bg-gradient-to-br from-slate-50 via-slate-300 to-slate-500 text-slate-900",
        ring: "ring-2 ring-slate-200/60",
        glow: "shadow-[0_4px_18px_rgba(203,213,225,0.25)]",
        pedestal: "from-slate-300/30 via-slate-400/10 to-transparent",
        height: "h-11",
    },
    {
        disc: "bg-gradient-to-br from-orange-200 via-orange-400 to-orange-700 text-orange-950",
        ring: "ring-2 ring-orange-300/50",
        glow: "shadow-[0_4px_18px_rgba(251,146,60,0.22)]",
        pedestal: "from-orange-400/30 via-orange-500/10 to-transparent",
        height: "h-8",
    },
];

/** 表彰台の表示順（銀・金・銅）。項目数に応じた実インデックスの並びを返す */
export function podiumOrder(count: number): number[] {
    if (count <= 0) return [];
    if (count === 1) return [0];
    if (count === 2) return [1, 0];
    return [1, 0, 2];
}

function rankLabel(rank: number, locale: string): string {
    if (locale === "en") return ["1st", "2nd", "3rd"][rank - 1] ?? `${rank}th`;
    return `${rank}位`;
}

function PodiumColumn({ rank, item, locale }: { rank: number; item: string; locale: string }) {
    const m = METALS[rank - 1];
    const first = rank === 1;
    return (
        <div
            className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1.5 story-media-in"
            style={{ animationDelay: `${rank * 80}ms` }}
        >
            {/* メダル（光沢スイープ付き） */}
            <div
                aria-label={rankLabel(rank, locale)}
                className={`relative overflow-hidden rounded-full flex items-center justify-center font-black tabular-nums ${
                    first ? "w-12 h-12 text-lg" : "w-9 h-9 text-sm"
                } ${m.disc} ${m.ring} ${m.glow}`}
            >
                {rank}
                <span
                    aria-hidden
                    className="medal-shine absolute top-0 bottom-0 w-1/3 bg-white/50 blur-[2px]"
                    style={{ animationDelay: `${rank * 500}ms` }}
                />
            </div>
            <p
                className={`w-full text-center leading-snug line-clamp-2 break-words ${
                    first ? "text-[13px] font-semibold text-white" : "text-xs text-white/80"
                }`}
            >
                {item}
            </p>
            {/* 表彰台 */}
            <div className={`w-full rounded-t-lg bg-gradient-to-b ${m.pedestal} ${m.height} ring-1 ring-white/10 flex items-start justify-center`}>
                <span className="text-[10px] tracking-widest text-white/45 mt-1.5">{rankLabel(rank, locale)}</span>
            </div>
        </div>
    );
}

export default function RankingCard({ title, items, locale = "ja", className = "" }: Props) {
    if (!items || items.length === 0) return null;
    const top = items.slice(0, 3);
    const rest = items.slice(3);

    return (
        <div className={`relative overflow-hidden rounded-2xl bg-[#16181c] ring-1 ring-white/10 p-4 ${className}`}>
            {/* 表彰台の背後にほのかな金色のグロー */}
            <div aria-hidden className="absolute -top-14 left-1/2 -translate-x-1/2 w-64 h-36 rounded-full bg-amber-400/10 blur-3xl pointer-events-none" />
            <div className="relative">
                <div className="flex items-center gap-2 mb-4">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-amber-200 to-amber-600 shadow-[0_2px_12px_rgba(251,191,36,0.4)]">
                        <TrophyIcon className="w-4 h-4 text-amber-950" />
                    </span>
                    <span className="text-sm font-bold text-white truncate">
                        {title || (locale === "en" ? "My Ranking" : "マイランキング")}
                    </span>
                    <span className="ml-auto flex-shrink-0 px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-semibold tracking-widest text-white/60">
                        TOP {items.length}
                    </span>
                </div>

                {/* 表彰台（2位 → 1位 → 3位） */}
                <div className="flex items-end gap-2 px-1">
                    {podiumOrder(top.length).map((i) => (
                        <PodiumColumn key={i} rank={i + 1} item={top[i]} locale={locale} />
                    ))}
                </div>

                {/* 4位以下 */}
                {rest.length > 0 && (
                    <ol className="mt-3 space-y-1">
                        {rest.map((item, idx) => (
                            <li
                                key={idx}
                                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] ring-1 ring-white/5 text-[13px] text-white/75"
                            >
                                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 text-[11px] font-bold text-white/55 flex items-center justify-center tabular-nums">
                                    {idx + 4}
                                </span>
                                <span className="truncate">{item}</span>
                            </li>
                        ))}
                    </ol>
                )}
            </div>
        </div>
    );
}
