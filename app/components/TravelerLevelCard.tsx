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

// 段位ごとのリアル金属パレット（明 / 中 / 暗 / 地）。
// tier 0=ブロンズ, 1=シルバー, 2=ゴールド, 3=プラチナ
const METALS = [
    { light: "#ffe2bd", mid: "#c97b38", dark: "#6e3a12", base: "#b5642a" }, // bronze
    { light: "#ffffff", mid: "#c7cfd6", dark: "#5b636b", base: "#9aa4ad" }, // silver
    { light: "#fff3bf", mid: "#f0bf3f", dark: "#8a5a10", base: "#e0a91e" }, // gold
    { light: "#ffffff", mid: "#dbe6ee", dark: "#7d8a95", base: "#c3d0da" }, // platinum
];

function tierLabel(tier: number, locale: "ja" | "en"): string {
    const ja = ["ブロンズ", "シルバー", "ゴールド", "プラチナ"];
    const en = ["Bronze", "Silver", "Gold", "Platinum"];
    return (locale === "en" ? en : ja)[tier] ?? "";
}

// 打ち出しコインのベゼル（上フチの光・下フチの影・内リムの磨き・落ち影・外周）
const BEZEL = [
    "inset 0 1.5px 1px rgba(255,255,255,0.8)",
    "inset 0 -2px 2px rgba(0,0,0,0.45)",
    "inset 0 0 0 1px rgba(255,255,255,0.25)",
    "0 2px 5px rgba(0,0,0,0.5)",
    "0 0 0 1px rgba(0,0,0,0.35)",
].join(", ");

// トロフィー棚の1マス（メダリオン）。実物のコイン光学を多層で再現する。
function BadgeMedallion({ slot, locale }: { slot: BadgeSlot; locale: "ja" | "en" }) {
    const earned = slot.tier >= 0;
    const isTop = slot.tier === slot.maxTier;
    const m = earned ? METALS[slot.tier] : null;
    return (
        <div className="flex flex-col items-center gap-1 min-w-0">
            {/* ディスク */}
            <div
                className="relative w-12 h-12 rounded-full overflow-hidden flex items-center justify-center text-base"
                style={m
                    ? {
                        // 異方性シーン（円周を回る明暗の金属反射）を地にする。これが金属感の要
                        background: `conic-gradient(from 220deg, ${m.dark}, ${m.mid}, ${m.light}, ${m.mid}, ${m.base}, ${m.dark}, ${m.mid}, ${m.light}, ${m.mid}, ${m.dark})`,
                        boxShadow: BEZEL,
                    }
                    : {
                        backgroundColor: "#15181c",
                        boxShadow: "inset 0 2px 4px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.06)",
                        border: "1px dashed rgba(255,255,255,0.12)",
                    }}
                title={earned ? `${slot.categoryLabel} ${slot.valueLabel} ・ ${tierLabel(slot.tier, locale)}` : slot.categoryLabel}
            >
                {m && (
                    <>
                        {/* ドーム陰影: 上に光・下エッジに影を乗せて球面の丸みを出す */}
                        <span
                            aria-hidden
                            className="absolute inset-0 rounded-full pointer-events-none"
                            style={{
                                background:
                                    "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.4), rgba(255,255,255,0) 42%)," +
                                    "radial-gradient(circle at 50% 118%, rgba(0,0,0,0.55), rgba(0,0,0,0) 55%)",
                            }}
                        />
                        {/* 最高段: ゆっくり回る薄いシーンで“生きた金属”の揺らぎ */}
                        {isTop && (
                            <span
                                aria-hidden
                                className="absolute inset-0 rounded-full mix-blend-overlay opacity-50 metal-sheen"
                                style={{ background: `conic-gradient(from 0deg, transparent, ${m.light}, transparent 40%, ${m.light} 60%, transparent 75%)` }}
                            />
                        )}
                        {/* 鏡面スペキュラ（左上の小さな光点） */}
                        <span
                            aria-hidden
                            className="absolute inset-0 rounded-full pointer-events-none"
                            style={{ background: "radial-gradient(circle at 32% 24%, rgba(255,255,255,0.95), rgba(255,255,255,0) 18%)" }}
                        />
                    </>
                )}
                {/* 絵文字: 金属に刻印されたエンボス */}
                <span
                    aria-hidden
                    className={`relative ${earned ? "" : "opacity-20 grayscale"}`}
                    style={earned ? { filter: "drop-shadow(0 1px 0 rgba(255,255,255,0.55)) drop-shadow(0 -1px 1px rgba(0,0,0,0.4))" } : undefined}
                >
                    {slot.emoji}
                </span>
                {/* 最高段だけ光沢スイープ */}
                {earned && isTop && (
                    <span aria-hidden className="medal-shine absolute top-0 bottom-0 w-1/3 bg-white/50 blur-[2px]" />
                )}
                {/* 段位ピップ（右下に小さく） */}
                {earned && (
                    <span className="absolute bottom-0 right-0 min-w-[14px] h-[14px] px-0.5 rounded-full bg-black/85 ring-1 ring-white/25 text-[8px] font-bold text-white flex items-center justify-center tabular-nums">
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
