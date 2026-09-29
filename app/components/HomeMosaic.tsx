"use client";

import React, { useSyncExternalStore } from "react";
import Link from "next/link";
import { HeartIcon, Square2StackIcon } from "@heroicons/react/24/outline";
import type { Photo, Locale } from "@/lib/data/photos";
import { getLocalized } from "@/lib/data/photos";
import { ROUTES } from "@/lib/routes";
import { photoAltText } from "@/lib/utils/photoAlt";
import { timeAgo } from "@/lib/stories";
import { editorialRows, shortPlace } from "@/lib/utils/editorialLayout";
import Thumb from "./Thumb";
import { MOSAIC_HERO_SIZES, MOSAIC_PAIR_SIZES } from "./gridSizes";

/**
 * ホームの写真の並び（iOS の `HomeMosaic`・板 01c と同じ組み・2026-09-29）。
 *
 * **大きく1枚（16:9）→ 2枚（1:1）→ 2枚** の繰り返しを、スマホでは端から端まで・
 * 隙間 4px・角なしで組む。撮影地と撮った人は写真の上に重ね、いいねの数は右下の
 * ガラスの丸。以前は縦1列の札（投稿者の行・題・説明・タグ・4つの操作）だった。
 * 題・説明・タグ・保存・共有・コメントは写真ページにある（iOS も同じ整理）。
 *
 * **iOS と変えたところ（理由つき）**
 * - **いいねの丸は数を見せるだけ**で、押すと写真ページが開く（丸は写真のリンクの中）。
 *   写真ごとのいいねの状態をサーバーへ引くと一覧を開くだけで N 往復になる
 *   （`TimelineCard` から引き継いだ判断・CLAUDE.md の優先度「表示速度」）
 * - **「…」（通報・ブロック）は置かない。** Web では写真ページにある
 * - 複数枚の印は `extraImages`（Web は1つの写真に追加の画像を持つ形）
 */
type Props = {
    photos: Photo[];
    locale: Locale;
    /** 最初の画面に入る枚数（`fetchPriority="high"`） */
    priorityCount?: number;
};

/** 段どうし・段の中の隙間（板: 4px） */
const GAP = 4;

export default function HomeMosaic({ photos, locale, priorityCount = 2 }: Props) {
    const rows = React.useMemo(() => editorialRows(photos), [photos]);
    // 何枚目か（先頭の数枚だけ priority）
    let n = 0;
    return (
        // スマホは画面の端から端まで（本文の `p-4` を打ち消す）。広い画面は箱の中
        <ol className="-mx-4 sm:mx-0 flex flex-col m-0 p-0" style={{ gap: GAP, listStyle: "none" }}>
            {rows.map((row) => {
                if (row.kind === "hero") {
                    const i = n++;
                    return (
                        <li key={`h-${row.item.id}`} className="m-0 p-0">
                            <HomeTile photo={row.item} locale={locale} large priority={i < priorityCount} />
                        </li>
                    );
                }
                const [a, b] = row.items;
                const ia = n++;
                const ib = n++;
                return (
                    <li key={`p-${a.id}-${b.id}`} className="m-0 p-0 grid grid-cols-2" style={{ gap: GAP }}>
                        <HomeTile photo={a} locale={locale} priority={ia < priorityCount} />
                        <HomeTile photo={b} locale={locale} priority={ib < priorityCount} />
                    </li>
                );
            })}
        </ol>
    );
}

/**
 * **サーバーでは描かない値**（「3日前」）のための札。静的書き出しはビルド時に文字列を
 * 焼くので、そのまま出すとビルドの翌日以降に水和が食い違う（`TimelineCard` と同じ理由）
 */
const subscribeNoop = () => () => {};
function useAfterHydration(): boolean {
    return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

/** ホームの1枚。写真・撮影地と撮った人の重ね・右下のいいねの数・複数枚の印 */
function HomeTile({ photo, locale, large = false, priority = false }: {
    photo: Photo; locale: Locale; large?: boolean; priority?: boolean;
}) {
    const isJa = locale !== "en";
    const title = getLocalized(photo.title, locale) || (typeof photo.title === "string" ? photo.title : "");
    const alt = photoAltText(photo, locale);
    const place = shortPlace(photo.location);
    const author = photo.displayName || (isJa ? "旅人" : "Traveler");
    const hydrated = useAfterHydration();
    // 投稿した時期は大きい段だけ（2枚の段は名前だけ・iOS と同じ）
    const ago = large && hydrated && photo.createdAt ? timeAgo(photo.createdAt, isJa ? "ja" : "en") : "";
    const byline = ago ? `${author} · ${ago}` : author;
    const likes = photo.likes ?? 0;
    // **壊れた要素は数えない**（`TimelineCard` と同じ）
    const extraCount = Array.isArray(photo.extraImages)
        ? photo.extraImages.filter((i) => typeof i?.src === "string" && !!i.src).length
        : 0;
    // 読み上げ（題 → 撮影地 → 撮った人 → 複数枚 → いいね）。画面に出ている文字を全部読む
    const label = [
        title || alt,
        place && !(title || alt).includes(place) ? place : "",
        byline,
        extraCount > 0 ? (isJa ? "複数枚の投稿" : "Multiple photos") : "",
        isJa ? `いいね ${likes}件` : `${likes} likes`,
    ].filter(Boolean).join(isJa ? "、" : ", ");

    return (
        <Link
            href={ROUTES.PHOTO(photo.id)}
            prefetch={false}
            aria-label={label}
            data-photo-id={photo.id}
            className="relative block overflow-hidden focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            style={{
                aspectRatio: large ? "16 / 9" : "1 / 1",
                backgroundColor: photo.dominantColor ?? "#121212",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
            } as React.CSSProperties}
        >
            <Thumb photo={photo} alt={alt} sizes={large ? MOSAIC_HERO_SIZES : MOSAIC_PAIR_SIZES}
                   cellAspect={large ? 16 / 9 : 1} priority={priority} />

            {/* 撮影地と撮った人（板: 明朝の撮影地、その下に小さく）。
                **撮影地が無い写真は文字を重ねず、下を薄く暗くするだけ**（いいねの丸を読ませる） */}
            {place ? (
                <div aria-hidden="true"
                     className="absolute inset-x-0 bottom-0 pointer-events-none"
                     style={{
                         padding: "48px 70px 12px 14px",
                         background: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.78) 60%, rgba(0,0,0,0.78) 100%)",
                     }}>
                    <p className="m-0 font-serif font-bold text-white truncate"
                       style={{ fontSize: large ? "22px" : "18px", lineHeight: 1.25, textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>
                        {place}
                    </p>
                    <p className="m-0 text-white/80 truncate" style={{ fontSize: "11px", lineHeight: "14px", marginTop: 2 }}>
                        {byline}
                    </p>
                </div>
            ) : (
                <div aria-hidden="true" className="absolute inset-x-0 bottom-0 pointer-events-none"
                     style={{ height: 56, background: "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.55))" }} />
            )}

            {/* 複数枚の印（板: 右上の重なった四角） */}
            {extraCount > 0 && (
                <Square2StackIcon aria-hidden="true" className="absolute text-white pointer-events-none"
                                  style={{ top: 8, right: 8, width: 18, height: 18, filter: "drop-shadow(0 0 3px rgba(0,0,0,0.5))" }} />
            )}

            {/* いいねの数（板: 右下のガラスの丸・32px・等幅の数）。押すと写真ページ */}
            <span aria-hidden="true"
                  className="absolute inline-flex items-center gap-1 rounded-full text-white bg-black/55 backdrop-blur-md pointer-events-none"
                  style={{ right: 6, bottom: 6, minWidth: 44, height: 32, padding: "0 10px", justifyContent: "center" }}>
                <HeartIcon style={{ width: 14, height: 14, strokeWidth: 2 }} />
                <span className="font-mono tabular-nums" style={{ fontSize: "11px" }}>{likes.toLocaleString()}</span>
            </span>
        </Link>
    );
}
