"use client";

import React from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";

type Props = {
    active: "all" | "following";
    locale: string;
    className?: string;
};

/**
 * 「すべて」（トップの一覧）と「フォロー中」（`/timeline`）の切り替え。
 *
 * 2つは**別のページ**——同じ見た目のピルを両方の頭に置いて、タブのように
 * 行き来できるようにする（owner の「インスタみたいに投稿タブがあって」）。
 * 選択中の側は**リンクにしない**（`<span aria-current="page">`）。トップで絞り込み中に
 * 「すべて」を `/` へのリンクにすると、同じルートへの遷移で画面が作り直されず
 * **絞りは残ったまま URL だけ `/` になる**（`GalleryPageClient` が同じ理屈を
 * `?photo=` について書いている。レビューが指摘）。押す意味のある側だけリンク。
 */
export default function FeedTabs({ active, locale, className = "" }: Props) {
    const isJa = locale !== "en";
    const tabs = [
        { key: "all" as const, href: ROUTES.HOME, label: isJa ? "すべて" : "All" },
        { key: "following" as const, href: ROUTES.TIMELINE, label: isJa ? "フォロー中" : "Following" },
    ];
    return (
        <div
            role="group"
            aria-label={isJa ? "表示する写真" : "Which photos to show"}
            className={`inline-flex items-center gap-1 p-1 rounded-full bg-white/5 ring-1 ring-white/10 ${className}`}
        >
            {tabs.map((t) => active === t.key ? (
                <span key={t.key} aria-current="page" className="px-4 py-1.5 rounded-full text-sm font-medium bg-white text-black">
                    {t.label}
                </span>
            ) : (
                <Link
                    key={t.key}
                    href={t.href}
                    prefetch={false}
                    className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors text-white/70 hover:text-white"
                    style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
                >
                    {t.label}
                </Link>
            ))}
        </div>
    );
}
