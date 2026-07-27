"use client";

// 旅人レベルカード: プロフィールに表示する中毒/エモ系の要素。
// このアプリ固有の「旅立たせた人数」を軸に、レベル・称号・進捗・実績バッジを見せる。

import React, { useEffect, useRef } from "react";
import type { Photo } from "@/lib/data/photos";
import { computeTravelerStats, travelerLevel, earnedBadges } from "../../lib/utils/travelerLevel";

type Props = {
    photos: Photo[];
    locale: "ja" | "en";
    /** 自分のプロフィールならレベルアップ時にトースト（任意） */
    isOwner?: boolean;
    onLevelUp?: (level: number, title: string) => void;
};

export default function TravelerLevelCard({ photos, locale, isOwner = false, onLevelUp }: Props) {
    const stats = React.useMemo(() => computeTravelerStats(photos), [photos]);
    const lvl = React.useMemo(() => travelerLevel(stats, locale), [stats, locale]);
    const badges = React.useMemo(() => earnedBadges(stats, locale), [stats, locale]);

    // 自分のプロフィール: 前回レベルを localStorage 記憶し、上がっていたら通知（サーバー不要）
    const firedRef = useRef(false);
    useEffect(() => {
        if (!isOwner || firedRef.current || stats.postCount === 0) return;
        firedRef.current = true;
        try {
            const key = "jp_traveler_level";
            const prev = Number(localStorage.getItem(key) ?? "0");
            if (lvl.level > prev && prev > 0) onLevelUp?.(lvl.level, lvl.title);
            localStorage.setItem(key, String(lvl.level));
        } catch { /* ignore */ }
    }, [isOwner, lvl.level, lvl.title, stats.postCount, onLevelUp]);

    // 投稿が無いユーザーには出さない
    if (stats.postCount === 0) return null;

    return (
        <div className="rounded-2xl bg-[#16181c] ring-1 ring-white/10 p-4 mb-4 max-w-md story-media-in">
            <div className="flex items-center gap-3">
                {/* レベルメダル */}
                <div
                    className="flex-shrink-0 w-12 h-12 rounded-full flex flex-col items-center justify-center text-black shadow-[0_2px_14px_rgba(56,189,248,0.35)]"
                    style={{ backgroundImage: "radial-gradient(circle at 32% 26%, #e0f2fe, #38bdf8 55%, #0369a1 100%)" }}
                >
                    <span className="text-[8px] font-bold leading-none tracking-wider opacity-80">Lv.</span>
                    <span className="text-lg font-black leading-none tabular-nums">{lvl.level}</span>
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white truncate">{lvl.title}</p>
                    {/* 進捗バー */}
                    <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400"
                            style={{ width: `${Math.round(lvl.progress * 100)}%` }}
                        />
                    </div>
                    <p className="mt-1 text-[10px] text-white/40 tabular-nums">
                        {lvl.nextAt === null
                            ? (locale === "en" ? "Max level" : "最高レベル")
                            : (locale === "en"
                                ? `${lvl.score} / ${lvl.nextAt} to Lv.${lvl.level + 1}`
                                : `Lv.${lvl.level + 1} まで ${lvl.score} / ${lvl.nextAt}`)}
                    </p>
                </div>
            </div>

            {badges.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {badges.map((b) => (
                        <span
                            key={b.key}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.06] ring-1 ring-white/10 text-[11px] text-white/80"
                        >
                            <span aria-hidden>{b.emoji}</span>
                            {b.label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
