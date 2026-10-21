import React from "react";
import Link from "next/link";

/**
 * **節の見出し**（iOS の `JPSectionHeading`・`JPEyebrowLine`・板 Components 05・2026-10-21 に共通化）:
 *
 *     眉ラベル（真鍮・SF 11・600・大文字）＋右へ消えていく真鍮の 1px の線
 *     ↓ 6
 *     明朝 22 の題                                   すべて見る ›（13・灰・当たり 44）
 *
 * 以前は「さがす」（`DiscoverSections`）だけがこの形を持ち、ホームの「おすすめ」は
 * 14px のゴシックの太字だった——同じアプリの中で節の声が割れていた。
 *
 * - **黒地の上だけで使う**（真鍮は写真の上では読めない・CLAUDE.md）
 * - 眉は英字の飾りなので読み上げに出さない（題が同じことを日本語で言う）
 * - **`id` は見える見出しに付ける**（`aria-labelledby` の行き先）
 * - 「すべて見る」は真鍮にしない——節の行き先は合図ではなく道（iOS の `MoreLink` と同じ）。
 *   行き先が無ければ出さない。**先読みしない**（公開ページの `<Link>` は全部そう）
 */
export default function SectionHead({
    id, eyebrow, title, href, moreLabel, testId = "section-head", className = "mb-3",
}: {
    id: string;
    eyebrow: string;
    title: string;
    href?: string;
    moreLabel?: string;
    testId?: string;
    className?: string;
}) {
    return (
        <div className={`flex items-end justify-between gap-3 ${className}`} data-testid={testId}>
            <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                <p aria-hidden="true" className="m-0 eyebrow eyebrow-line text-accent">{eyebrow}</p>
                <h2 id={id} className="m-0 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "1.3" }}>{title}</h2>
            </div>
            {href && moreLabel && (
                <Link
                    href={href}
                    prefetch={false}
                    className="flex-shrink-0 inline-flex items-center min-h-[44px] text-white/70 hover:text-white transition-colors"
                    style={{ fontSize: "13px", touchAction: "manipulation" }}
                >
                    {moreLabel}
                </Link>
            )}
        </div>
    );
}
