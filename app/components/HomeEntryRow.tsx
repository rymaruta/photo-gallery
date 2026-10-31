import React from "react";
import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { ROW_CARD, ROW_CHEVRON } from "./rowStyles";

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
            // 2026-10-30 束 0b C11: 共通の札の行（1行の行 52・白8%の縁・角 16・字 15）。以前は 44・縁なし・字 14
            className={`mb-3 ${ROW_CARD}`}
            style={{ touchAction: "manipulation" }}
        >
            <span className="shrink-0 eyebrow text-accent">
                {eyebrow}
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px] leading-[20px]">
                {text}
            </span>
            <ChevronRightIcon className={ROW_CHEVRON} aria-hidden />
        </Link>
    );
}
