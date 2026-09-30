"use client";

import React, { useSyncExternalStore } from "react";
import Link from "next/link";
import { HeartIcon, Square2StackIcon } from "@heroicons/react/24/outline";
import type { Photo, Locale } from "@/lib/data/photos";
import { ROUTES } from "@/lib/routes";
import { photoAltText } from "@/lib/utils/photoAlt";
import { timeAgo } from "@/lib/stories";
import { editorialRows, shortPlace } from "@/lib/utils/editorialLayout";
import Thumb from "./Thumb";
import { MOSAIC_HERO_SIZES, MOSAIC_PAIR_SIZES } from "./gridSizes";

/**
 * ホームの写真の並び（iOS の `HomeMosaic`・板 01c と同じ組み・2026-09-29）。
 * **3つのタブ（おすすめ・フォロー中・新着）すべてがこれで描く**（iOS と同じ）。
 *
 * **大きく1枚（16:9）→ 2枚（1:1）→ 2枚** の繰り返しを、スマホでは端から端まで・
 * 隙間 4px・角なしで組む。撮影地と撮った人は写真の上に重ね、いいねの数は右下の
 * ガラスの丸。以前は縦1列の札（投稿者の行・題・説明・タグ・4つの操作）だった。
 * 題・説明・タグ・保存・共有・コメントは写真ページにある（iOS も同じ整理）。
 *
 * **iOS と変えたところ（理由つき）**
 * - **いいねの丸は数を見せるだけ**で、押すと写真ページが開く（丸は写真のリンクの中）。
 *   写真ごとのいいねの状態をサーバーへ引くと一覧を開くだけで N 往復になる
 *   （以前の縦1列の札から引き継いだ判断・CLAUDE.md の優先度「表示速度」）
 * - **「…」（通報・ブロック）は置かない。** Web では写真ページにある
 * - 複数枚の印は `extraImages`（Web は1つの写真に追加の画像を持つ形）
 */
type Props = {
    photos: Photo[];
    locale: Locale;
    /** 最初に読む枚数（`fetchPriority="high"`）。既定は大きい1枚＋最初の2枚の段＝3枚
     *  （2枚だと同じ段の右だけ遅れて出る） */
    priorityCount?: number;
};

/** 段どうし・段の中の隙間（板: 4px） */
const GAP = 4;

export default function HomeMosaic({ photos, locale, priorityCount = 3 }: Props) {
    const rows = React.useMemo(() => editorialRows(photos), [photos]);
    // 大きい段かどうかを**何番目か**で引く（並びそのものは `editorialRows` が決める）。
    // id で引くと、同じ写真が2回入ったときに両方とも大きく出て、2枚の段に穴が空く
    const large = React.useMemo(() => {
        const at = new Set<number>();
        let i = 0;
        for (const r of rows) {
            if (r.kind === "hero") at.add(i);
            i += r.kind === "hero" ? 1 : 2;
        }
        return at;
    }, [rows]);
    return (
        // **写真1枚ごとに `<li>`**（大きい1枚は2列ぶん）。段ごとに作ると、一覧が1枚ずれただけで
        // 全部の段の組み合わせが変わり、全部の写真が作り直される（読み込み途中の画像が一度消える）。
        // スマホは画面の端から端まで（本文の `p-4` を打ち消す）。広い画面は箱の中
        <ol className="-mx-4 sm:mx-0 grid grid-cols-2 m-0 p-0" style={{ gap: GAP, listStyle: "none" }}>
            {photos.map((p, i) => (
                <li key={p.id} className={`m-0 p-0 ${large.has(i) ? "col-span-2" : ""}`}>
                    <HomeTile photo={p} locale={locale} large={large.has(i)} priority={i < priorityCount} />
                </li>
            ))}
        </ol>
    );
}

/**
 * **サーバーでは描かない値**（「3日前」）のための札。静的書き出しはビルド時に文字列を
 * 焼くので、そのまま出すとビルドの翌日以降に水和が食い違う（`Thumb` と同じ理由）
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
    const alt = photoAltText(photo, locale);
    const place = shortPlace(photo.location);
    const author = photo.displayName || (isJa ? "旅人" : "Traveler");
    const hydrated = useAfterHydration();
    // 投稿した時期は大きい段だけ（2枚の段は名前だけ・iOS と同じ）
    const ago = large && hydrated && photo.createdAt ? timeAgo(photo.createdAt, isJa ? "ja" : "en") : "";
    const byline = ago ? `${author} · ${ago}` : author;
    const likes = photo.likes ?? 0;
    // 持ち主が選んだ見せたい位置（`CropFramePicker`）。16:9 の枠がいちばん大きく切り落とすので効く
    const objectPosition = photo.focalPoint
        ? `${Math.round(photo.focalPoint.x * 100)}% ${Math.round(photo.focalPoint.y * 100)}%`
        : undefined;
    // **壊れた要素は数えない**（`src` の無い要素で「複数枚」と言わない）
    const extraCount = Array.isArray(photo.extraImages)
        ? photo.extraImages.filter((i) => typeof i?.src === "string" && !!i.src).length
        : 0;

    return (
        <Link
            href={ROUTES.PHOTO(photo.id)}
            prefetch={false}
            // **読み上げの名前は中身から組む（`aria-label` を付けない）**（2026-09-30）。
            // 画像の説明（題・撮影地）→ 撮影地 → 撮った人 → 複数枚 → いいねの数、の順に読む。
            // `aria-label` で別の文を付けていたので、画面に見えている文字と読み上げの名前が
            // 食い違っていた（Lighthouse の label-content-name-mismatch・トップの全タイル）。
            // 見える文字を名前に含めるには、見出しの段を読ませるのが素直な形
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
                   cellAspect={large ? 16 / 9 : 1} priority={priority} objectPosition={objectPosition} />

            {/* 撮影地と撮った人（板: 明朝の撮影地、その下に小さく）。
                **撮影地が無い写真は文字を重ねず、下を薄く暗くするだけ**（いいねの丸を読ませる） */}
            {place ? (
                <div className="absolute inset-x-0 bottom-0 pointer-events-none"
                     style={{
                         padding: "48px 70px 12px 14px",
                         background: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.78) 60%, rgba(0,0,0,0.78) 100%)",
                     }}>
                    {/* 写真の説明（alt）が撮影地を含むなら、ここは読ませない（同じ地名が続けて
                        二度読まれた。alt は「題（撮影地）」の形）。見える文字のままで名前には
                        `aria-label` を使っていないので、label-content-name-mismatch には戻らない */}
                    <p aria-hidden={alt.includes(place) ? true : undefined}
                       className="m-0 font-serif font-bold text-white truncate"
                       style={{ fontSize: large ? "22px" : "18px", lineHeight: 1.25, textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>
                        {place}
                    </p>
                    <p className="m-0 text-white/80 truncate" style={{ fontSize: "11px", lineHeight: "14px", marginTop: 2 }}>
                        {byline}
                    </p>
                </div>
            ) : (
                <>
                    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 pointer-events-none"
                         style={{ height: 56, background: "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.55))" }} />
                    {/* 撮影地が無い写真は名前を重ねない（iOS と同じ）が、**誰の写真かは読ませる** */}
                    <span className="sr-only">{byline}</span>
                </>
            )}

            {/* 複数枚の印（板: 右上の重なった四角） */}
            {extraCount > 0 && (
                <>
                    <Square2StackIcon aria-hidden="true" className="absolute text-white pointer-events-none"
                                      style={{ top: 8, right: 8, width: 18, height: 18, filter: "drop-shadow(0 0 3px rgba(0,0,0,0.5))" }} />
                    <span className="sr-only">{isJa ? "、複数枚の投稿" : ", Multiple photos"}</span>
                </>
            )}

            {/* いいねの数（板: 右下のガラスの丸・32px・等幅の数）。押すと写真ページ */}
            {/* 見える数は数字だけ。読み上げは「、いいね 3件」（英語は「, 3 likes」）を**1つの文で**持つ。
                区切りは文の中に書く——名前の計算は実装によって空白の扱いが違う（jsdom は隣と
                空白なしでつなぎ「いいね3件」「1like」になった。Chrome は前後に空白を入れる） */}
            <span className="absolute inline-flex items-center gap-1 rounded-full text-white bg-black/55 backdrop-blur-md pointer-events-none"
                  style={{ right: 6, bottom: 6, minWidth: 44, height: 32, padding: "0 10px", justifyContent: "center" }}>
                <HeartIcon aria-hidden="true" style={{ width: 14, height: 14, strokeWidth: 2 }} />
                <span aria-hidden="true" className="font-mono tabular-nums" style={{ fontSize: "11px" }}>{likes.toLocaleString()}</span>
                <span className="sr-only">
                    {isJa ? `、いいね ${likes.toLocaleString()}件` : `, ${likes.toLocaleString()} ${likes === 1 ? "like" : "likes"}`}
                </span>
            </span>
        </Link>
    );
}
