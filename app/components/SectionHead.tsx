import React from "react";
import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

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
    /** 眉。**無ければ明朝 22 の題だけ**（iOS の `JPSectionHeading(eyebrow: nil)`・撮影地の頁の節・2026-10-31 束 2） */
    eyebrow?: string;
    /** 題（文字か、言語で出し分ける部品＝`Lang`） */
    title: React.ReactNode;
    href?: string;
    moreLabel?: string;
    testId?: string;
    className?: string;
}) {
    return (
        <div className={`flex items-end justify-between gap-3 ${className}`} data-testid={testId}>
            <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                {eyebrow && <p aria-hidden="true" className="m-0 eyebrow eyebrow-line text-accent">{eyebrow}</p>}
                <h2 id={id} className="m-0 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "1.3" }}>{title}</h2>
            </div>
            {href && moreLabel && <MoreLink href={href} label={moreLabel} />}
        </div>
    );
}

/**
 * **「すべて見る ›」**（iOS の `MoreLink`・2026-10-30 束 0b C10）。13・text-2・右に小さい ›・当たり 44×44。
 * 以前は白70% の字だけで、› は字の中に書く所と無い所が割れていた。真鍮にしない（合図ではなく道）。先読みしない
 */
export function MoreLink({ href, label, testId }: { href: string; label: string; testId?: string }) {
    return (
        <Link
            href={href}
            prefetch={false}
            data-testid={testId}
            className="flex-shrink-0 inline-flex items-center justify-end gap-1 min-h-[44px] min-w-[44px] text-text-2 hover:text-white transition-colors"
            style={{ fontSize: "13px", lineHeight: "18px", touchAction: "manipulation" }}
        >
            {label}
            <ChevronRightIcon aria-hidden="true" style={{ width: 12, height: 12, strokeWidth: 2 }} />
        </Link>
    );
}

/**
 * **静かな節の見出し**（iOS の `JPSectionTitle`・板「札の上の小さい見出し」・2026-10-30 束 0b C10）。
 * 12・medium・白60%。札（設定・撮影情報など）の上に置く。眉ライン型（`SectionHead`）と2つだけにする
 */
export function SectionTitle({ id, children, as: Tag = "h2", className = "mb-2" }: {
    id?: string; children: React.ReactNode; as?: "h2" | "h3"; className?: string;
}) {
    return (
        <Tag id={id} className={`m-0 px-1 font-medium text-white/60 ${className}`} style={{ fontSize: "12px", lineHeight: "16px" }}>
            {children}
        </Tag>
    );
}
