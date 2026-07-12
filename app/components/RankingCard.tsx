"use client";

// マイランキングの表彰台カード。
// 上位3位は金・銀・銅のメダル + 高さの違うガラス台座（2位→1位→3位の並び）、
// 4位以下はリスト行。ヘッダータップで折りたたみでき、状態は端末に記憶する。

import React, { useEffect, useState } from "react";
import { TrophyIcon } from "@heroicons/react/24/solid";
import { ChevronDownIcon } from "@heroicons/react/24/outline";

type Props = {
    title?: string;
    items: string[];
    locale?: string;
    className?: string;
};

const OPEN_KEY = "jp_ranking_open";

// 金・銀・銅の配色（index = 順位 - 1）。
// メダルは左上ハイライトのラジアルグラデーションで金属球らしく見せる。
const METALS = [
    {
        medal: "radial-gradient(circle at 32% 26%, #fff8d9, #fbbf24 48%, #a16207 100%)",
        ring: "ring-2 ring-amber-200/60",
        glow: "shadow-[0_6px_28px_rgba(251,191,36,0.4)]",
        edge: "bg-gradient-to-r from-amber-500/0 via-amber-300 to-amber-500/0",
        text: "text-amber-950",
        height: "h-16",
    },
    {
        medal: "radial-gradient(circle at 32% 26%, #ffffff, #cbd5e1 48%, #64748b 100%)",
        ring: "ring-2 ring-slate-100/50",
        glow: "shadow-[0_4px_18px_rgba(203,213,225,0.28)]",
        edge: "bg-gradient-to-r from-slate-300/0 via-slate-200 to-slate-300/0",
        text: "text-slate-900",
        height: "h-11",
    },
    {
        medal: "radial-gradient(circle at 32% 26%, #ffdfba, #e8943a 48%, #7c3f0d 100%)",
        ring: "ring-2 ring-orange-200/40",
        glow: "shadow-[0_4px_18px_rgba(232,148,58,0.28)]",
        edge: "bg-gradient-to-r from-orange-400/0 via-orange-300 to-orange-400/0",
        text: "text-orange-950",
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
            className="flex-1 min-w-0 flex flex-col items-center justify-end gap-2 story-media-in"
            style={{ animationDelay: `${rank * 80}ms` }}
        >
            {/* メダル（金属球風 + 光沢スイープ） */}
            <div
                aria-label={rankLabel(rank, locale)}
                className={`relative overflow-hidden rounded-full flex items-center justify-center font-black tabular-nums ${
                    first ? "w-[3.25rem] h-[3.25rem] text-lg" : "w-9 h-9 text-sm"
                } ${m.text} ${m.ring} ${m.glow}`}
                style={{ backgroundImage: m.medal }}
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
            {/* 台座: 上端に金属色のライン + 透かしの順位数字だけのガラス板 */}
            <div className={`relative w-full ${m.height} rounded-t-lg overflow-hidden bg-white/[0.045] ring-1 ring-white/10`}>
                <span aria-hidden className={`absolute top-0 inset-x-0 h-[2.5px] ${m.edge}`} />
                <span aria-hidden className="absolute inset-0 flex items-center justify-center text-3xl font-black text-white/[0.07] select-none">
                    {rank}
                </span>
            </div>
        </div>
    );
}

export default function RankingCard({ title, items, locale = "ja", className = "" }: Props) {
    // 折りたたみ。既定は開いた状態で、選択は端末に記憶する
    const [open, setOpen] = useState(true);
    useEffect(() => {
        try { if (localStorage.getItem(OPEN_KEY) === "0") setOpen(false); } catch { /* ignore */ }
    }, []);
    const toggle = () => {
        setOpen((v) => {
            try { localStorage.setItem(OPEN_KEY, v ? "0" : "1"); } catch { /* ignore */ }
            return !v;
        });
    };

    if (!items || items.length === 0) return null;
    const top = items.slice(0, 3);
    const rest = items.slice(3);

    return (
        <div className={`relative overflow-hidden rounded-2xl bg-[#16181c] ring-1 ring-white/10 ${className}`}>
            {/* 表彰台の背後にほのかな金色のグロー */}
            {open && (
                <div aria-hidden className="absolute -top-14 left-1/2 -translate-x-1/2 w-64 h-36 rounded-full bg-amber-400/10 blur-3xl pointer-events-none" />
            )}
            <div className="relative">
                {/* ヘッダー全体がトグル（閉じてもお題は見える） */}
                <button
                    onClick={toggle}
                    aria-expanded={open}
                    className="w-full flex items-center gap-2 px-4 py-3.5 text-left hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors"
                    style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                >
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full shadow-[0_2px_12px_rgba(251,191,36,0.4)]" style={{ backgroundImage: METALS[0].medal }}>
                        <TrophyIcon className="w-4 h-4 text-amber-950" />
                    </span>
                    <span className="text-sm font-bold text-white truncate">
                        {title || (locale === "en" ? "My Ranking" : "マイランキング")}
                    </span>
                    <span className="ml-auto flex-shrink-0 px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-semibold tracking-widest text-white/60">
                        TOP {items.length}
                    </span>
                    <ChevronDownIcon className={`w-4 h-4 text-white/45 flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                </button>

                {open && (
                    <div className="px-4 pb-4">
                        {/* 表彰台（2位 → 1位 → 3位） */}
                        <div className="flex items-end gap-2.5 px-1 pt-1.5">
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
                )}
            </div>
        </div>
    );
}
