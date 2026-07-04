"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { XMarkIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import type { StoryGroup } from "@/lib/stories";
import { timeAgo } from "@/lib/stories";

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";
const STORY_DURATION_MS = 5000;
const TICK_MS = 50;

type Props = {
    groups: StoryGroup[];
    initialGroupIndex: number;
    locale: "ja" | "en";
    onSeen: (storyId: string) => void;
    onClose: () => void;
};

export default function StoryViewer({ groups, initialGroupIndex, locale, onSeen, onClose }: Props) {
    const [g, setG] = useState(initialGroupIndex);
    const [i, setI] = useState(0);
    const [progress, setProgress] = useState(0); // 0-100
    const [paused, setPaused] = useState(false);
    const [avatarError, setAvatarError] = useState(false);

    const group = groups[g];
    const item = group?.items[i];

    // 表示したストーリーを既読にする
    useEffect(() => {
        if (item) onSeen(item.id);
    }, [item, onSeen]);

    const goNext = useCallback(() => {
        setProgress(0);
        if (group && i < group.items.length - 1) {
            setI(i + 1);
        } else if (g < groups.length - 1) {
            setG(g + 1);
            setI(0);
        } else {
            onClose();
        }
    }, [group, groups.length, g, i, onClose]);

    const goPrev = useCallback(() => {
        setProgress(0);
        if (i > 0) {
            setI(i - 1);
        } else if (g > 0) {
            const prevGroup = groups[g - 1];
            setG(g - 1);
            setI(Math.max(0, prevGroup.items.length - 1));
        }
    }, [groups, g, i]);

    // 自動送りタイマー
    useEffect(() => {
        if (paused || !item) return;
        const timer = setInterval(() => {
            setProgress((p) => {
                const next = p + (TICK_MS / STORY_DURATION_MS) * 100;
                return next >= 100 ? 100 : next;
            });
        }, TICK_MS);
        return () => clearInterval(timer);
    }, [paused, item]);

    useEffect(() => {
        if (progress >= 100) goNext();
    }, [progress, goNext]);

    // 次の画像をプリロード
    useEffect(() => {
        const next = group?.items[i + 1] ?? groups[g + 1]?.items[0];
        if (next) {
            const img = new window.Image();
            img.src = next.src;
        }
    }, [group, groups, g, i]);

    // Escで閉じる / 矢印キーで移動
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowRight") goNext();
            else if (e.key === "ArrowLeft") goPrev();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose, goNext, goPrev]);

    // 背景スクロールロック
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = prev; };
    }, []);

    if (!group || !item) return null;

    const avatarUrl = CLOUDFRONT_URL ? `${CLOUDFRONT_URL}/profiles/${encodeURIComponent(group.userId)}` : "";

    return (
        <div
            className="fixed inset-0 z-[90] bg-black flex items-center justify-center select-none"
            role="dialog"
            aria-modal="true"
            aria-label={locale === "en" ? "Stories" : "ストーリー"}
        >
            {/* 画像 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                key={item.id}
                src={item.src}
                alt=""
                className="max-w-full max-h-full object-contain"
                draggable={false}
            />

            {/* 上部グラデーション + プログレスバー + ヘッダー */}
            <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-black/70 to-transparent pt-2 pb-8 px-2 pointer-events-none">
                <div className="flex gap-1 mb-2.5" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
                    {group.items.map((s, idx) => (
                        <div key={s.id} className="flex-1 h-0.5 rounded-full bg-white/25 overflow-hidden">
                            <div
                                className="h-full bg-white"
                                style={{ width: idx < i ? "100%" : idx === i ? `${progress}%` : "0%" }}
                            />
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-2 px-1">
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex items-center justify-center flex-shrink-0">
                        {avatarUrl && !avatarError ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatarUrl} alt="" className="w-full h-full object-cover" onError={() => setAvatarError(true)} />
                        ) : (
                            <UserCircleIcon className="w-5 h-5 text-white/50" />
                        )}
                    </div>
                    <span className="text-sm font-semibold text-white drop-shadow">{group.displayName}</span>
                    <span className="text-xs text-white/60">{timeAgo(item.createdAt, locale)}</span>
                </div>
            </div>

            {/* 閉じる */}
            <button
                onClick={onClose}
                aria-label={locale === "en" ? "Close" : "閉じる"}
                className="absolute top-3 right-2 z-20 p-2.5 text-white/80 hover:text-white"
                style={{ touchAction: "manipulation", marginTop: "env(safe-area-inset-top, 0px)" }}
            >
                <XMarkIcon className="w-6 h-6" />
            </button>

            {/* タップ領域: 左1/3で戻る、右2/3で進む。長押しで一時停止 */}
            <div
                className="absolute inset-y-0 left-0 w-1/3 z-10"
                onClick={goPrev}
                onPointerDown={() => setPaused(true)}
                onPointerUp={() => setPaused(false)}
                onPointerLeave={() => setPaused(false)}
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
            />
            <div
                className="absolute inset-y-0 right-0 w-2/3 z-10"
                onClick={goNext}
                onPointerDown={() => setPaused(true)}
                onPointerUp={() => setPaused(false)}
                onPointerLeave={() => setPaused(false)}
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
            />
        </div>
    );
}
