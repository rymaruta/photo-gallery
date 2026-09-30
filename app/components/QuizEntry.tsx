import React from "react";
import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { ROUTES } from "../../lib/routes";

/**
 * ホームの「今日の一問」への入口（`/q`）。**1行だけ**——ホームの並びは owner の指示が
 * 細かく入っている面なので、写真の並びより前に大きな札を足さない。
 * 3つのタブのどれでも同じ位置（タブの直下）に出す＝切り替えても見出しの位置が動かない。
 *
 * 字は iOS の小見出しと同じ声（等幅・真鍮＝合図）＋本文は白。的は 44px。
 * 問題の中身（写真・選択肢）はここでは読まない——開いた日の分を `/q` が読む。
 */
export default function QuizEntry({ locale }: { locale: "ja" | "en" }) {
    const en = locale === "en";
    return (
        <Link
            href={ROUTES.QUIZ}
            prefetch={false}
            data-testid="home-quiz-entry"
            className="mb-3 flex items-center gap-3 min-h-[44px] px-4 rounded-xl bg-surface hover:bg-surface-2 text-white transition-colors"
            style={{ touchAction: "manipulation" }}
        >
            <span className="shrink-0 font-mono font-medium uppercase text-accent" style={{ fontSize: "11px", letterSpacing: "1.5px" }}>
                {en ? "Daily quiz" : "今日の一問"}
            </span>
            <span className="min-w-0 flex-1 truncate" style={{ fontSize: "14px" }}>
                {en ? "Where is this photo?" : "この写真はどこ？"}
            </span>
            <ChevronRightIcon className="w-4 h-4 shrink-0 text-white/60" aria-hidden />
        </Link>
    );
}
