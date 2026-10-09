"use client";

/**
 * 名前の横の **Pro の印** と **選んだメダル**（認証済みの封印 `VerifiedBadge` のあとに置く）。
 *
 * 並びは owner の決定どおり: 名前 → 認証済みの封印 → Pro の印 → 選んだメダル。
 * メダルを出すのは**プロフィールの画面だけ**（ここ）。
 *
 * - Pro の印は `pro === true` の人にだけ。形は本人が選ぶ（`iris` 既定・`plate`）。
 *   **Web では何も売らない**——立っている人に出すだけ
 * - メダルは `displayBadge` が**持っている鍵**のときだけ（`sanitizeProfile` が落としてある）。
 *   押すとその人のメダルの一覧を開く
 *
 * 大きさは素材の README（`lib/data/badges.ts` の注記）。
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { lockBodyScroll, unlockBodyScroll } from "../../lib/utils/scrollLock";
import {
    badgeImage, badgeLabel, badgeDescription, nameBadgeBox, ownedBadges, proMarkImage,
    type BadgeKey, type BadgeMap, type ProMarkStyle,
} from "../../lib/data/badges";

type Locale = "ja" | "en";

export function ProMark({ pro, style = "iris", size = 20, locale }: {
    pro?: boolean; style?: ProMarkStyle; size?: number; locale: Locale;
}) {
    if (pro !== true) return null;
    const label = locale === "en" ? "Pro member" : "Pro メンバー";
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={proMarkImage(style, size)}
            alt={label}
            title={label}
            width={size}
            height={size}
            className="shrink-0"
            data-testid="pro-mark"
            style={{ width: size, height: size }}
        />
    );
}

/** 撮った日付（その段を初めて取った日）。表示は日付まで */
function formatAt(at: string, locale: Locale): string {
    const t = Date.parse(at);
    if (Number.isNaN(t)) return "";
    try {
        return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ja-JP", {
            year: "numeric", month: locale === "en" ? "short" : "long", day: "numeric", timeZone: "Asia/Tokyo",
        }).format(t);
    } catch {
        return "";
    }
}

/** その人のメダルの一覧（押したメダルから開く） */
function MedalListDialog({ badges, ownerName, locale, onClose, restoreRef }: {
    badges: BadgeMap | undefined;
    ownerName: string;
    locale: Locale;
    onClose: () => void;
    restoreRef: React.RefObject<HTMLButtonElement | null>;
}) {
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const closeRef = useRef<HTMLButtonElement | null>(null);
    useEscapeKey(true, onClose);
    useFocusTrap(true, dialogRef, restoreRef, closeRef);
    useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);
    const list = ownedBadges(badges);
    const title = locale === "en" ? `${ownerName}'s medals` : `${ownerName}のメダル`;
    return (
        <div
            ref={dialogRef}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            data-testid="medal-list"
        >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
            <div className="relative z-10 w-full max-w-sm max-h-[80vh] flex flex-col rounded-3xl bg-surface ring-1 ring-white/10 shadow-2xl shadow-black/60 story-media-in">
                <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
                    <h2 className="text-base font-bold tracking-tight text-white truncate">{title}</h2>
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        aria-label={locale === "en" ? "Close" : "閉じる"}
                        className="flex-shrink-0 inline-flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition"
                        style={{ width: 44, height: 44, marginRight: -10 }}
                    >
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>
                {list.length === 0 ? (
                    <p className="px-5 pb-6 text-white/50 text-[13px]">
                        {locale === "en" ? "No medals yet." : "まだメダルはありません。"}
                    </p>
                ) : (
                    <ul className="overflow-y-auto overscroll-contain px-5 pb-5 divide-y divide-white/5">
                        {list.map(({ key, tier, at }) => (
                            <li key={key} className="flex items-center gap-3.5 py-3">
                                {/* 季節の章で絵の無い年は、同じ大きさの空きにする（文字の並びをそろえる） */}
                                {badgeImage(key, tier, false) ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={badgeImage(key, tier, false)!} alt="" width={56} height={56} loading="lazy" className="shrink-0" style={{ width: 56, height: 56 }} />
                                ) : (
                                    <span aria-hidden="true" className="shrink-0" style={{ width: 56, height: 56 }} />
                                )}
                                <div className="min-w-0">
                                    <p className="text-[15px] font-semibold text-white leading-snug">{badgeLabel(key, tier, locale)}</p>
                                    <p className="text-[13px] text-white/60 leading-snug">{badgeDescription(key, tier, locale)}</p>
                                    {formatAt(at, locale) && (
                                        <p className="text-[12px] text-white/50 leading-snug tabular-nums">{formatAt(at, locale)}</p>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

/** 名前の横の、選んだメダル（押すと一覧） */
export function NameBadge({ badges, displayBadge, ownerName, locale }: {
    badges?: BadgeMap;
    displayBadge?: BadgeKey | null;
    ownerName: string;
    locale: Locale;
}) {
    const [open, setOpen] = useState(false);
    const btnRef = useRef<HTMLButtonElement | null>(null);
    const chosen = displayBadge ? badges?.[displayBadge] : undefined;
    // 絵の無いメダル（季節の章で絵がまだ無い年）は名前の横に出さない
    const src = displayBadge && chosen ? badgeImage(displayBadge, chosen.tier, true) : null;
    if (!displayBadge || !chosen || !src) return null;
    const { size, margin } = nameBadgeBox(displayBadge);
    const label = badgeLabel(displayBadge, chosen.tier, locale);
    return (
        <>
            <button
                ref={btnRef}
                type="button"
                onClick={() => setOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={locale === "en" ? `Medal: ${label}. Show all medals` : `メダル: ${label}。メダルの一覧を開く`}
                title={label}
                className="shrink-0 inline-flex items-center justify-center rounded-full active:scale-95 transition"
                style={{ width: size, height: size, margin, touchAction: "manipulation" }}
                data-testid="name-badge"
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />
            </button>
            {/* **body へ出す。** ボタンは見出し（`<h1>`）の中に居るので、そのまま描くと
                見出しの中に見出し（`<h2>`）と `<div>` が入る */}
            {open && typeof document !== "undefined" && createPortal(
                <MedalListDialog
                    badges={badges}
                    ownerName={ownerName}
                    locale={locale}
                    onClose={() => setOpen(false)}
                    restoreRef={btnRef}
                />,
                document.body,
            )}
        </>
    );
}
