"use client";

// 旅人レベルカード: プロフィールに表示する中毒/エモ系の要素。
// このアプリ固有の「旅立たせた人数」を軸に、レベル・称号・進捗・実績バッジを見せる。

import React, { useEffect, useRef } from "react";
import type { Photo } from "@/lib/data/photos";
import { computeTravelerStats, travelerLevel, travelerBadgeBoard, type BadgeSlot } from "../../lib/utils/travelerLevel";

type Props = {
    photos: Photo[];
    locale: "ja" | "en";
    /** 自分のプロフィールならレベルアップ時にトースト（任意） */
    isOwner?: boolean;
    onLevelUp?: (level: number, title: string) => void;
};

// 段位ごとのメタルカラー（RankingCard と同系の放射グラデ）。
// tier -1=未獲得（ロック）, 0=ブロンズ, 1=シルバー, 2=ゴールド, 3=プラチナ
const TIER_METAL = [
    "radial-gradient(circle at 32% 26%, #ffdfba, #e8943a 48%, #7c3f0d 100%)",  // bronze
    "radial-gradient(circle at 32% 26%, #ffffff, #cbd5e1 48%, #64748b 100%)",  // silver
    "radial-gradient(circle at 32% 26%, #fff8d9, #fbbf24 48%, #a16207 100%)",  // gold
    "radial-gradient(circle at 32% 26%, #ffffff, #a5f3fc 45%, #0e7490 100%)",  // platinum
];
const TIER_RING = ["ring-amber-300/40", "ring-slate-200/50", "ring-amber-200/60", "ring-cyan-200/60"];

function tierLabel(tier: number, locale: "ja" | "en"): string {
    const ja = ["ブロンズ", "シルバー", "ゴールド", "プラチナ"];
    const en = ["Bronze", "Silver", "Gold", "Platinum"];
    return (locale === "en" ? en : ja)[tier] ?? "";
}

// トロフィー棚の1マス（メダリオン）
function BadgeMedallion({ slot, locale }: { slot: BadgeSlot; locale: "ja" | "en" }) {
    const earned = slot.tier >= 0;
    const isTop = slot.tier === slot.maxTier;
    return (
        <div className="flex flex-col items-center gap-1 min-w-0">
            {/* ディスク */}
            <div
                className={`relative w-11 h-11 rounded-full flex items-center justify-center text-base ring-2 ${
                    earned ? `${TIER_RING[slot.tier]} shadow-[0_2px_12px_rgba(0,0,0,0.35)]` : "ring-white/10"
                }`}
                style={earned
                    ? { backgroundImage: TIER_METAL[slot.tier] }
                    : { backgroundColor: "#1c1f24", borderStyle: "dashed" }}
                title={earned ? `${slot.categoryLabel} ${slot.valueLabel} ・ ${tierLabel(slot.tier, locale)}` : slot.categoryLabel}
            >
                <span aria-hidden className={earned ? "" : "opacity-25 grayscale"}>{slot.emoji}</span>
                {/* 最高段だけ光沢スイープ */}
                {earned && isTop && (
                    <span aria-hidden className="medal-shine absolute top-0 bottom-0 w-1/3 bg-white/50 blur-[2px] rounded-full overflow-hidden" />
                )}
                {/* 段位ピップ（右下に小さく） */}
                {earned && (
                    <span className="absolute -bottom-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-black/80 ring-1 ring-white/20 text-[8px] font-bold text-white flex items-center justify-center tabular-nums">
                        {slot.tier + 1}
                    </span>
                )}
            </div>
            {/* ラベル */}
            <span className={`text-[10px] leading-tight text-center truncate w-full ${earned ? "text-white/70" : "text-white/30"}`}>
                {slot.categoryLabel}
            </span>
            <span className={`text-[10px] leading-none text-center tabular-nums ${earned ? "text-white/90 font-semibold" : "text-white/25"}`}>
                {earned
                    ? slot.valueLabel
                    : (slot.nextThreshold !== null
                        ? (locale === "en" ? `${slot.nextThreshold}+` : `あと${Math.max(0, slot.nextThreshold - slot.currentValue)}`)
                        : "-")}
            </span>
        </div>
    );
}

export default function TravelerLevelCard({ photos, locale, isOwner = false, onLevelUp }: Props) {
    const stats = React.useMemo(() => computeTravelerStats(photos), [photos]);
    const lvl = React.useMemo(() => travelerLevel(stats, locale), [stats, locale]);
    const board = React.useMemo(() => travelerBadgeBoard(stats, locale), [stats, locale]);
    const earnedCount = board.filter((s) => s.tier >= 0).length;

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

            {/* トロフィー棚: 全カテゴリのメダリオン（獲得＝メタル色、未獲得＝薄いロック） */}
            <div className="mt-4 pt-3 border-t border-white/10">
                <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[11px] tracking-widest uppercase text-white/40">
                        {locale === "en" ? "Achievements" : "実績バッジ"}
                    </span>
                    <span className="text-[10px] text-white/40 tabular-nums">{earnedCount} / {board.length}</span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                    {board.map((slot) => (
                        <BadgeMedallion key={slot.categoryKey} slot={slot} locale={locale} />
                    ))}
                </div>
            </div>
        </div>
    );
}
