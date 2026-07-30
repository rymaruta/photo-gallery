"use client";

// 旅人レベルカード: プロフィールに表示する中毒/エモ系の要素。
// このアプリ固有の「旅立たせた人数」を軸に、レベル・称号・進捗・実績バッジを見せる。

import React, { useEffect, useRef } from "react";
import { PaperAirplaneIcon, GlobeAltIcon, HeartIcon, MapPinIcon, CameraIcon } from "@heroicons/react/24/outline";
import type { Photo } from "@/lib/data/photos";
import { computeTravelerStats, travelerLevel, travelerBadgeBoard, type BadgeSlot } from "../../lib/utils/travelerLevel";

type Props = {
    photos: Photo[];
    locale: "ja" | "en";
    /** 自分のプロフィールならレベルアップ時にトースト（任意） */
    isOwner?: boolean;
    onLevelUp?: (level: number, title: string) => void;
};

// カテゴリ→サイト共通の単色線アイコン（絵文字をやめてトーンを揃える）
const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
    moved: (p) => <PaperAirplaneIcon {...p} />,
    distance: GlobeAltIcon,
    likes: HeartIcon,
    places: MapPinIcon,
    posts: CameraIcon,
};

// 段位のアクセント色（金属ではなく“色の格”で静かに示す。淡く）
const TIER_ACCENT = ["text-white/55", "text-sky-300", "text-emerald-300", "text-amber-200"];
const TIER_DOT = ["bg-white/55", "bg-sky-300", "bg-emerald-300", "bg-amber-200"];

// トロフィー棚の1マス。サイト共通のダーク・ガラス＋単色アイコン＋控えめアクセント。
function BadgeMedallion({ slot, locale }: { slot: BadgeSlot; locale: "ja" | "en" }) {
    const earned = slot.tier >= 0;
    const Icon = CATEGORY_ICON[slot.categoryKey] ?? CameraIcon;
    const accent = earned ? TIER_ACCENT[slot.tier] : "text-white/25";
    return (
        <div
            className={`flex flex-col items-center gap-1.5 rounded-2xl px-1.5 pt-2.5 pb-2 ring-1 ${
                earned ? "bg-white/[0.05] ring-white/10" : "bg-white/[0.02] ring-white/[0.06] ring-dashed"
            }`}
            title={earned ? `${slot.categoryLabel} ${slot.valueLabel}` : slot.categoryLabel}
        >
            {/* アイコン（moved は紙飛行機を斜めに） */}
            <Icon className={`w-5 h-5 ${accent} ${slot.categoryKey === "moved" ? "-rotate-45" : ""} ${earned ? "" : "opacity-60"}`} />

            {/* 段位ドット（獲得段=アクセント色 / 未獲得段=薄い白） */}
            <div className="flex items-center gap-0.5" aria-hidden>
                {Array.from({ length: slot.maxTier + 1 }).map((_, i) => (
                    <span key={i} className={`w-1 h-1 rounded-full ${earned && i <= slot.tier ? TIER_DOT[slot.tier] : "bg-white/15"}`} />
                ))}
            </div>

            {/* カテゴリ名 */}
            <span className={`text-[10px] leading-tight text-center truncate w-full ${earned ? "text-white/70" : "text-white/30"}`}>
                {slot.categoryLabel}
            </span>
            {/* 値 or 次目標 */}
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
