"use client";

import React from "react";
import Link from "next/link";
import type { Photo, Locale } from "@/lib/data/photos";
import { getLocalized } from "@/lib/data/photos";
import { ROUTES } from "@/lib/routes";
import { photoAltText } from "@/lib/utils/photoAlt";
import { timeAgo } from "@/lib/stories";
import Thumb from "./Thumb";
import ProfileLink from "./ProfileLink";
import { FEED_SIZES_XL } from "./gridSizes";

type Props = {
    photo: Photo;
    locale: Locale;
    /** 最初の画面に入る数枚だけ true（`fetchPriority="high"`） */
    priority?: boolean;
};

/**
 * タイムラインの1枚。**誰が・いつ上げたか**を写真の上に置く——一覧のグリッドは
 * サムネだけ並ぶので、誰の写真か分からない（owner の「混ざってる」）。
 *
 * 画像は一覧と同じ `Thumb`（512px の派生まで）。写真ページの主役（≤1600）を
 * 流し読みの面で1枚ずつ落とすのは重すぎる。押せば写真ページで原寸に近い方が出る。
 */
export default function TimelineCard({ photo, locale, priority = false }: Props) {
    const title = getLocalized(photo.title, locale) || (typeof photo.title === "string" ? photo.title : "");
    const alt = photoAltText(photo, locale);
    // 「いつ上げたか」。撮影日ではない（並びと同じ理由。`lib/utils/timeline.ts`）。
    // **`createdAt` は UTC の瞬間（`…Z`）**なので、書かれた数字をそのまま出す
    // `formatStoredDateTime` に通すと JST の人には9時間前の時刻になる
    // （実測 `2026-04-29T23:10:00Z` → 「4月29日 23:10」＝本当は 4/30 08:10。
    // レビューが発見。写真ページが `createdAt` にフォールバックしないのも同じ理由）。
    // ストーリー・コメントと同じ相対表記（「3日前」）なら閲覧者のゾーンで正しい
    const posted = photo.createdAt ? timeAgo(photo.createdAt, locale === "en" ? "en" : "ja") : "";
    // 実寸があればその比で枠を予約する（読み込み後に高さが伸びて下がガタつかない）。
    // 無ければ一覧と同じ 3:2
    const ratio = photo.width && photo.height && photo.width > 0 && photo.height > 0
        ? (photo.height / photo.width) * 100
        : 75;

    return (
        <article className="rounded-2xl bg-white/5 ring-1 ring-white/10 overflow-hidden">
            <header className="flex items-center justify-between gap-3 px-3 py-2.5">
                {/* **名前の箱は縮んでよい。** `ProfileLink` の中の `break-words` は
                    フレックス行の子としての最小幅（＝空白の無い名前1語の幅）を縮めない
                    ので、100文字の名前で `<time>` がカードの外へ押し出される（レビューが
                    Chromium 320px で実測: 名前 999px・日付の left 1077px）。箱に `min-w-0`
                    ＋中の名前を `overflow-wrap: anywhere` で折る。`overflow-hidden` は
                    それでも溢れた回の最後の砦 */}
                <div className="min-w-0 overflow-hidden [&_span]:wrap-anywhere">
                    {photo.userId ? (
                        <ProfileLink userId={photo.userId} displayName={photo.displayName || "旅人"} size="sm" />
                    ) : (
                        <span className="text-xs sm:text-sm text-white/60">{photo.displayName || "旅人"}</span>
                    )}
                </div>
                {posted && (
                    <time className="text-xs text-white/50 flex-shrink-0" dateTime={photo.createdAt}>
                        {posted}
                    </time>
                )}
            </header>

            <Link
                href={ROUTES.PHOTO(photo.id)}
                prefetch={false}
                className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                aria-label={title ? `${title} を開く` : "写真を開く"}
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
                data-photo-id={photo.id}
            >
                <div
                    className="relative w-full overflow-hidden"
                    style={{ paddingTop: `${ratio}%`, backgroundColor: photo.dominantColor ?? "#111", fontSize: 0, lineHeight: 0 }}
                >
                    <Thumb photo={photo} alt={alt} sizes={FEED_SIZES_XL} priority={priority} />
                </div>
            </Link>

            {(title || photo.location) && (
                <div className="px-3 py-2.5">
                    {title && <p className="text-sm text-white/90 break-words m-0">{title}</p>}
                    {photo.location && <p className="text-xs text-white/60 break-words m-0 mt-0.5">{photo.location}</p>}
                </div>
            )}
        </article>
    );
}
