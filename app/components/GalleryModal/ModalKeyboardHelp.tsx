"use client";
import React from "react";
import type { Locale } from "@/lib/data/photos";

const SHORTCUTS = [
    { key: "← →", ja: "前後の写真", en: "Prev / Next photo" },
    { key: "Esc",  ja: "閉じる",     en: "Close" },
    { key: "H",    ja: "お気に入り切替", en: "Toggle favorite" },
    { key: "?",    ja: "このヘルプを表示", en: "Show this help" },
];

type Props = { locale: Locale; onClose: () => void };

export default function ModalKeyboardHelp({ locale, onClose }: Props) {
    return (
        <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/70"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
            <div
                className="bg-[#0f1113] border border-white/15 rounded-xl p-6 w-72 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-sm font-semibold text-white mb-4">
                    {locale === "en" ? "Keyboard Shortcuts" : "キーボードショートカット"}
                </h3>
                <ul className="space-y-2.5 text-sm">
                    {SHORTCUTS.map(({ key, ja, en }) => (
                        <li key={key} className="flex items-center justify-between gap-4">
                            <kbd className="px-2 py-0.5 rounded bg-white/10 text-white/80 font-mono text-xs tracking-wide">{key}</kbd>
                            <span className="text-white/60 text-xs">{locale === "en" ? en : ja}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-4 text-xs text-white/30 text-center">
                    {locale === "en" ? "Swipe ↓ to close on mobile" : "モバイルは下スワイプで閉じる"}
                </p>
            </div>
        </div>
    );
}
