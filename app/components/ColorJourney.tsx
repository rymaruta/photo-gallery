"use client";

import React, { useMemo, useState } from "react";
import type { Photo, Locale } from "@/lib/data/photos";
import GalleryGrid from "./GalleryGrid";
import { GRID_SIZES_5XL } from "./gridSizes";
import { visibleColorBuckets } from "../../lib/color/buckets";

/**
 * Color Journey — 写真の**色**でさがす。
 *
 * ## `GalleryPageClient` の中で描く（自前で写真を取らない）
 *
 * 最初は `/search` の上に独立して置き、`usePhotos()` を自分で呼んでいた。
 * `GalleryPageClient` が別の作業中だったためで、その代償として3つ残していた
 * （レビューが指摘・台帳に記録）:
 *
 * 1. `usePhotos()` が2つ動き、`/search` を開くたびに `GET /photos` が2回飛ぶ。
 *    片方だけ失敗すると上下で一覧がずれる
 * 2. `onOpenPhoto` が無く、ビルド後に上がった写真（`ROUTES.PHOTO` が
 *    `/?photo=<id>` に落とす）を押すとトップへ遷移して開く。下のグリッドは
 *    その場のモーダルで開くのに
 * 3. 下の一覧が絞り込まれていても、色の内訳は公開写真の全部ぶん出る
 *
 * **3つとも「写真を外から受け取る」だけで消える。** この部品は写真を
 * 取りに行かず、`GalleryPageClient` が持っている `filteredPhotos`（絞り込み
 * 後の一覧）と `openById`（モーダルを開く）と `categoryDisplayMap` を
 * そのまま受け取る。フックは1つ、開き方は下のグリッドと同じ、色の内訳は
 * **いま見ている一覧の中**で数える（タグの件数バッジと同じ考え方）。
 *
 * ## 何も無いときは、何も描かない
 *
 * コミット済みの `app/data/photos.json` は `dominantColor` を持たない
 * （派生の欄が落ちた古い断面。本番は 39/39 が持つ）。`verify-local.sh` が
 * 足す「本番の形」も `thumbSrc` と AVIF だけで色は足さないので、**手元の
 * スモークではこの部品は丸ごと何も描かない**。それは正しい姿（空のチップを
 * 10個並べない）で、テストが固定している。
 *
 * 本番では SSR の時点でチップが在る（断面に色が入っている）。サーバーも
 * クライアントの最初の1回も同じ断面を読むので水和は食い違わない
 * （本番の色を手元に注入して build → Chromium で確認済み・PR #72）。
 */

type Props = {
    /** 色で分ける写真。**呼ぶ側の絞り込み後の一覧**を渡す（全写真ではなく） */
    photos: Photo[];
    locale: Locale;
    /** 下のグリッドと同じ地図（渡さないとサムネの下のカテゴリ名が上下で違う） */
    categoryDisplayMap: Record<string, string>;
    /** 静的ページの無い新着写真をその場のモーダルで開く。下のグリッドと同じもの */
    onOpenPhoto?: (photoId: string) => boolean;
};

/** 寸法は **px で書く**——640px 未満で root が 14px に落ちるので rem は縮む */
const STYLE = {
    section: { marginTop: 4, marginBottom: 16 } as React.CSSProperties,
    heading: { fontSize: 15, fontWeight: 700, letterSpacing: "0.02em", margin: 0 } as React.CSSProperties,
    lead: { fontSize: 12, marginTop: 2 } as React.CSSProperties,
    chipRow: { marginTop: 10, gap: 6 } as React.CSSProperties,
    /** `FilterBar` の `chipBase` と同じ値（あちらは部品の中の `useMemo` で外から引けない） */
    chip: { padding: "6px 14px", minHeight: 32, borderRadius: 9999, flexShrink: 0 } as React.CSSProperties,
    swatch: { width: 10, height: 10, borderRadius: 9999, flexShrink: 0 } as React.CSSProperties,
    grid: { marginTop: 12 } as React.CSSProperties,
};

export default function ColorJourney({ photos, locale, categoryDisplayMap, onOpenPhoto }: Props) {
    const [selected, setSelected] = useState<string | null>(null);

    // 色の仕分けは写真が変わったときだけ
    const buckets = useMemo(() => visibleColorBuckets(photos), [photos]);

    /**
     * **選んだ色が消えたら、選択そのものを捨てる。**
     * 一覧が入れ替わる（API が届く・絞り込みが変わる）と、さっき選んだ色が
     * 最小枚数を割ることがある。`selected` を持ったままにすると、色が戻った
     * 瞬間に**押していないのにチップが光ってグリッドが開く**。
     *
     * `useEffect` で `setState` を呼ぶ形は lint（`set-state-in-effect`）が
     * 止めるので、React が案内している「前回の入力を控えて、変わっていたら
     * 描画中に直す」形にする。`buckets` は `photos` に対して memo されて
     * いるので、同一性が変わるのは一覧が入れ替わったときだけ。
     */
    const [seenBuckets, setSeenBuckets] = useState(buckets);
    if (seenBuckets !== buckets) {
        setSeenBuckets(buckets);
        if (selected !== null && !buckets.some((b) => b.bucket.id === selected)) setSelected(null);
    }

    const current = buckets.find((b) => b.bucket.id === selected) ?? null;

    // 色が1つも立たない＝描くものが無い（手元の断面がこれ）
    if (buckets.length === 0) return null;

    return (
        // `GalleryPageClient` の `<main>` の中・`<h1>` のあとに置かれるので、
        // 見出しは h2 でよい（独立して上に置いていた頃は h2 → h1 の順に
        // なるので region の名前だけにしていた）
        <section style={STYLE.section} aria-labelledby="color-journey-heading">
            {/* 文言は日本語だけ。チップの名前（`COLOR_BUCKETS.label`）が日本語しか
                持たないので、見出しだけ英語にすると英語の見出しの下に「青」「黒」が
                並ぶ（レビューで指摘）。英語化するなら表ごと */}
            <h2 id="color-journey-heading" style={STYLE.heading}>色でさがす</h2>
            <p className="text-white/50" style={STYLE.lead}>いま出ている写真の中から、色で辿る</p>

            {/* 1行の横スクロール。`FilterBar` のカテゴリ（単一選択）と同じ形 */}
            <div className="flex overflow-x-auto no-scrollbar -mx-1 px-1" style={STYLE.chipRow}>
                {buckets.map(({ bucket, photos: inBucket }) => {
                    const active = current?.bucket.id === bucket.id;
                    return (
                        <button
                            key={bucket.id}
                            type="button"
                            // **`role="switch"` ではなく `aria-pressed`。** 1つ選ぶと他が外れる
                            // 単一選択なので、`FilterBar` のカテゴリ行と同じ申告にする
                            // （switch は「それぞれ独立に on/off」の意味で、タグ入力の側）
                            aria-pressed={active}
                            aria-label={`${bucket.label} (${inBucket.length})`}
                            // **押し直すと外れる。** 足すだけのチップは、既に選んで
                            // いる色を押しても無反応になる（タグ入力で踏んだ形）
                            onClick={() => setSelected(active ? null : bucket.id)}
                            className={`inline-flex items-center gap-1.5 text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                                active
                                    ? "bg-white text-black font-medium"
                                    : "bg-white/[0.07] text-white/70 hover:bg-white/15 hover:text-white/90"
                            }`}
                            style={{
                                ...STYLE.chip,
                                touchAction: "manipulation",
                                WebkitTapHighlightColor: "transparent",
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    ...STYLE.swatch,
                                    backgroundColor: bucket.swatch,
                                    // 黒い丸は黒地に沈むので、縁を1本引く
                                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)",
                                }}
                            />
                            <span>{bucket.label}</span>
                            <span className={active ? "text-black/55 text-[11px]" : "text-white/50 text-[11px]"}>
                                {inBucket.length}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* **承知のうえで残していること（レビューで指摘）:**
                - ここから開いたモーダルの前後送りは、色の部分集合ではなく
                  **下の一覧（`filteredPhotos`）全体**を回る。`FeaturedSections` から
                  開いたときと同じ形で、部分集合ごとにモーダルを持つ作りにはしない
                - 選んだ色の写真は下のグリッドにも在るので、サムネが2回描かれる
                  （先頭8枚は優先読み込みも2回）。色を押した人の操作に律速されるので
                  初期表示は重くならない */}
            {current ? (
                <div style={STYLE.grid}>
                    <GalleryGrid
                        photos={current.photos}
                        locale={locale}
                        categoryDisplayMap={categoryDisplayMap}
                        onOpenPhoto={onOpenPhoto}
                        sizes={GRID_SIZES_5XL}
                    />
                </div>
            ) : null}
        </section>
    );
}
