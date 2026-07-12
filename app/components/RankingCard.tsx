"use client";

// マイランキングのカード。
// 金・銀・銅のメダル + 項目名のシンプルなリスト（順位表示はメダルの数字だけ）。
// 1位の行だけ淡い金のハイライトで主役感を出す。
// ヘッダータップで折りたたみでき、状態は端末に記憶する。

import React, { useState } from "react";
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
        glow: "shadow-[0_2px_14px_rgba(251,191,36,0.35)]",
        text: "text-amber-950",
    },
    {
        medal: "radial-gradient(circle at 32% 26%, #ffffff, #cbd5e1 48%, #64748b 100%)",
        ring: "ring-2 ring-slate-100/50",
        glow: "",
        text: "text-slate-900",
    },
    {
        medal: "radial-gradient(circle at 32% 26%, #ffdfba, #e8943a 48%, #7c3f0d 100%)",
        ring: "ring-2 ring-orange-200/40",
        glow: "",
        text: "text-orange-950",
    },
];

function rankLabel(rank: number, locale: string): string {
    if (locale === "en") return ["1st", "2nd", "3rd"][rank - 1] ?? `${rank}th`;
    return `${rank}位`;
}

export default function RankingCard({ title, items, locale = "ja", className = "" }: Props) {
    // 折りたたみ。既定は開いた状態で、選択は端末に記憶する。
    // このカードはプロフィール取得後にクライアント側でのみマウントされるため、
    // 遅延初期化で localStorage を読んでもハイドレーション不整合は起きない
    const [open, setOpen] = useState(() => {
        if (typeof window === "undefined") return true;
        try { return localStorage.getItem(OPEN_KEY) !== "0"; } catch { return true; }
    });
    const toggle = () => {
        setOpen((v) => {
            try { localStorage.setItem(OPEN_KEY, v ? "0" : "1"); } catch { /* ignore */ }
            return !v;
        });
    };

    if (!items || items.length === 0) return null;

    return (
        <div className={`relative overflow-hidden rounded-2xl bg-[#16181c] ring-1 ring-white/10 ${className}`}>
            {/* 背後にほのかな金色のグロー */}
            {open && (
                <div aria-hidden className="absolute -top-14 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full bg-amber-400/[0.08] blur-3xl pointer-events-none" />
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
                    <ol className="px-3 pb-3 space-y-1.5">
                        {items.map((item, idx) => {
                            const m = METALS[idx];
                            const first = idx === 0;
                            return (
                                <li
                                    key={idx}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-xl story-media-in ${
                                        first
                                            ? "bg-gradient-to-r from-amber-400/[0.12] to-transparent ring-1 ring-amber-300/20"
                                            : "bg-white/[0.04] ring-1 ring-white/5"
                                    }`}
                                    style={{ animationDelay: `${idx * 60}ms` }}
                                >
                                    {m ? (
                                        // 金・銀・銅のメダル（金属球風 + 光沢スイープ）
                                        <span
                                            aria-label={rankLabel(idx + 1, locale)}
                                            className={`relative overflow-hidden flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-black text-sm tabular-nums ${m.text} ${m.ring} ${m.glow}`}
                                            style={{ backgroundImage: m.medal }}
                                        >
                                            {idx + 1}
                                            <span
                                                aria-hidden
                                                className="medal-shine absolute top-0 bottom-0 w-1/3 bg-white/50 blur-[2px]"
                                                style={{ animationDelay: `${idx * 500}ms` }}
                                            />
                                        </span>
                                    ) : (
                                        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 text-xs font-bold text-white/55 flex items-center justify-center tabular-nums">
                                            {idx + 1}
                                        </span>
                                    )}
                                    <span className={`min-w-0 truncate ${first ? "text-[15px] font-semibold text-white" : "text-[13px] text-white/85"}`}>
                                        {item}
                                    </span>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>
        </div>
    );
}
