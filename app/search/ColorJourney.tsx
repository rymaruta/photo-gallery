"use client";

import React, { useMemo, useState } from "react";
import GalleryGrid from "../components/GalleryGrid";
import { GRID_SIZES_5XL } from "../components/gridSizes";
import { useLocale } from "../i18n/context";
import { usePhotos } from "../../lib/hooks/usePhotos";
import { visibleColorBuckets } from "../../lib/color/buckets";

/**
 * Color Journey — 写真の**色**でさがす。
 *
 * ## 既存の部品に手を入れずに足す
 *
 * `/search` はいま `GalleryPageClient` を描いているだけで、あの部品は
 * 別の作業が入っている最中。だから**触らずに、この部品を上へ足す**。
 * 写真は `usePhotos()`（＝公開の一覧 `GET /photos`）から取る——同じものを
 * 二度作らないし、**公開の判定はサーバーが済ませている**
 * （`published` が false でない・`src` を持つ・ストーリーでない）ので、
 * 非公開や下書きがここへ来ることはない。
 *
 * ## 何も無いときは、何も描かない
 *
 * `usePhotos()` の初期値はビルド時の断面（`app/data/photos.json`）で、
 * **そこには `dominantColor` が1枚も入っていない**。だから最初の描画では
 * チップが0個になり、API の一覧が届いてから現れる。
 *
 * **これは水和のずれにならない**——サーバーが描くのも、クライアントの
 * 最初の描画も、同じ断面（色なし＝0個）だから。差が出るのは API が
 * 返ったあとの再描画で、そこは React が正しく差し替える。
 * （`24f9df2c` で踏んだ「水和後にサムネが消える」は、サーバーと
 *  クライアントの**最初の1回**が食い違った件。ここは食い違わない。）
 *
 * 手元・テスト・staging では色が1つも立たないので、**この部品は丸ごと
 * 何も描かない**。それが正しい姿（空のチップを10個並べない）。
 */

/** 見出しと説明。**px で書く**——640px 未満で root が 14px に落ちるので rem は縮む */
const STYLE = {
    section: { paddingTop: 4, paddingBottom: 8 } as React.CSSProperties,
    heading: { fontSize: 15, fontWeight: 700, letterSpacing: "0.02em" } as React.CSSProperties,
    lead: { fontSize: 12, marginTop: 2 } as React.CSSProperties,
    chipRow: { marginTop: 10, gap: 6 } as React.CSSProperties,
    chip: { padding: "6px 12px", minHeight: 32, borderRadius: 9999, flexShrink: 0 } as React.CSSProperties,
    swatch: { width: 10, height: 10, borderRadius: 9999, flexShrink: 0 } as React.CSSProperties,
    grid: { marginTop: 12 } as React.CSSProperties,
};

export default function ColorJourney() {
    const { locale } = useLocale();
    const { photos } = usePhotos();
    const [selected, setSelected] = useState<string | null>(null);

    // 色の仕分けは写真が変わったときだけ
    const buckets = useMemo(() => visibleColorBuckets(photos), [photos]);

    /**
     * **選んだ色が消えたときに掴んだままにしない。**
     * 写真が届いて一覧が入れ替わると、さっき選んだ色が最小枚数を割ることが
     * ある。`selected` をそのまま信じると、チップはどれも光っていないのに
     * 下のグリッドだけが残る（または空の枠が出る）。
     */
    const current = buckets.find((b) => b.bucket.id === selected) ?? null;

    // 色が1つも立たない＝描くものが無い（手元の断面がこれ）
    if (buckets.length === 0) return null;

    return (
        <section
            className="text-white bg-black max-w-5xl mx-auto w-full px-4 sm:px-6 md:px-8"
            style={STYLE.section}
            aria-labelledby="color-journey-heading"
        >
            <h2 id="color-journey-heading" style={STYLE.heading}>色でさがす</h2>
            <p className="text-white/50" style={STYLE.lead}>写真の色から辿る</p>

            {/* 1行の横スクロール。`FilterBar` のピルと同じ形に揃える */}
            <div className="flex overflow-x-auto no-scrollbar -mx-1 px-1" style={STYLE.chipRow}>
                {buckets.map(({ bucket, photos: inBucket }) => {
                    const active = bucket.id === selected;
                    return (
                        <button
                            key={bucket.id}
                            type="button"
                            role="switch"
                            aria-checked={active}
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

            {current ? (
                <div style={STYLE.grid}>
                    <GalleryGrid photos={current.photos} locale={locale} sizes={GRID_SIZES_5XL} />
                </div>
            ) : null}
        </section>
    );
}
