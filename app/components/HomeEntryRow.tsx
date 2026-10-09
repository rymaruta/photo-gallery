import React from "react";
import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

/**
 * ホームのタブの直下に置く**1行の入口**（今日の一問・撮影スポット）。
 *
 * ホームの並びは owner の指示が細かく入っている面なので、写真の並びより前に
 * 大きな札を足さない——入口は**この1行の形だけ**にそろえる。
 * 字は iOS の小見出しと同じ声（等幅・真鍮＝合図）＋本文は白。的は 44px。
 * 先読みはしない（`CLAUDE.md`「表示速度で踏んだ大きい穴」）。
 */
export default function HomeEntryRow({ href, eyebrow, text, testId }: {
    href: string;
    eyebrow: string;
    text: string;
    testId: string;
}) {
    return (
        <Link
            href={href}
            prefetch={false}
            data-testid={testId}
            className="mb-3 flex items-center gap-3 min-h-[44px] px-4 rounded-xl bg-surface hover:bg-surface-2 text-white transition-colors"
            style={{ touchAction: "manipulation" }}
        >
            <span className="shrink-0 font-mono font-medium uppercase text-accent" style={{ fontSize: "11px", letterSpacing: "1.5px" }}>
                {eyebrow}
            </span>
            <span className="min-w-0 flex-1 truncate" style={{ fontSize: "14px" }}>
                {text}
            </span>
            <ChevronRightIcon className="w-4 h-4 shrink-0 text-white/60" aria-hidden />
        </Link>
    );
}
