"use client";

import React, { useMemo, useState } from "react";
import GalleryGrid from "../components/GalleryGrid";
import { GRID_SIZES_5XL } from "../components/gridSizes";
import { useLocale } from "../i18n/context";
import { usePhotos } from "../../lib/hooks/usePhotos";
import { visibleColorBuckets } from "../../lib/color/buckets";
import { photoCategoryMap } from "../../lib/utils/categoryMap";

/**
 * Color Journey — 写真の**色**でさがす。
 *
 * ## 既存の部品に手を入れずに足す
 *
 * `/search` はいま `GalleryPageClient` を描いているだけで、あの部品は
 * 別の作業が入っている最中でトップとも共用している。だから**触らずに、
 * この部品を上へ足す**。写真は `usePhotos()`（＝公開の一覧 `GET /photos`）
 * から取る——**公開の判定はサーバーが済ませている**（`published` が false
 * でない・`src` を持つ・ストーリーでない。`api/src/ddb-photos.ts` の
 * `FilterExpression`）ので、非公開や下書きがここへ来ることはない。
 *
 * ## 触らないことで残る3つ（レビューで指摘・承知のうえで残す）
 *
 * 1. **`usePhotos()` が2つ動く**（ここと `GalleryPageClient`）。`/search` を
 *    開くたびに `GET /photos` が2回飛び、片方だけ失敗すると上下で一覧が
 *    ずれうる。フックを持ち上げるには `GalleryPageClient` を触ることになる
 * 2. **`onOpenPhoto` を渡していない。** ビルド後に上がった写真は
 *    `ROUTES.PHOTO` が `/?photo=<id>` に落とすので、下のグリッドは
 *    その場のモーダルで開くのに、こちらはトップへ遷移して開く。
 *    モーダルは `GalleryPageClient` の `useGallery` が持っていて外から呼べない
 * 3. **ログイン中の既定は「自分」なのに、こちらは全員の写真。** 下の一覧が
 *    本人の写真に絞られていても、色の内訳は公開写真39枚ぶん出る。
 *    「公開されている写真から」と一言添えて、違うものを見せていることを
 *    画面の上で言う
 *
 * `GalleryPageClient` が落ち着いたら、3つとも**そちらに寄せて**解く
 * （フックを1つにし、`openById` と `filteredPhotos` を受け取る形）。
 *
 * ## 本番では最初の描画からチップが出る
 *
 * `usePhotos()` の初期値はビルド時の断面（`app/data/photos.json`）。
 * **本番の断面は `dominantColor` を持つ**——`sync-photos-from-ddb.js` は
 * `PRIVATE_FIELDS` を落とすだけで、色は残る（実測 39/39）。だから本番では
 * サーバーが描く HTML に既にチップが在り、そのまま水和する。
 * サーバーもクライアントの最初の1回も同じ断面を読むので、食い違わない
 * （本番の色を手元の断面に注入して build → Chromium で 390px/1280px とも
 *  5チップ・選択で11枚・解除で0枚・ページエラー無し を確認済み）。
 *
 * **コミット済みの断面は色を持たない**（派生の欄が落ちた古い断面）。
 * `verify-local.sh` が足す「本番の形」も `thumbSrc` と AVIF だけで色は
 * 足さないので、**手元のスモークではこの部品は丸ごと何も描かない**。
 * それは正しい姿（空のチップを10個並べない）で、テストが固定している。
 */

/** 寸法は **px で書く**——640px 未満で root が 14px に落ちるので rem は縮む */
const STYLE = {
    section: { paddingTop: 4, paddingBottom: 8 } as React.CSSProperties,
    title: { fontSize: 15, fontWeight: 700, letterSpacing: "0.02em" } as React.CSSProperties,
    lead: { fontSize: 12, marginTop: 2 } as React.CSSProperties,
    chipRow: { marginTop: 10, gap: 6 } as React.CSSProperties,
    /** `FilterBar` の `chipBase` と同じ値（あちらは部品の中の `useMemo` で外から引けない） */
    chip: { padding: "6px 14px", minHeight: 32, borderRadius: 9999, flexShrink: 0 } as React.CSSProperties,
    swatch: { width: 10, height: 10, borderRadius: 9999, flexShrink: 0 } as React.CSSProperties,
    grid: { marginTop: 12 } as React.CSSProperties,
};

export default function ColorJourney() {
    const { locale, labels } = useLocale();
    const { photos } = usePhotos();
    const [selected, setSelected] = useState<string | null>(null);

    // 色の仕分けは写真が変わったときだけ
    const buckets = useMemo(() => visibleColorBuckets(photos), [photos]);
    // 下のグリッドと同じ規則でカテゴリ名を引く（`/favorites` と同じ）
    const categoryDisplayMap = useMemo(() => photoCategoryMap(photos, labels.category.names ?? {}), [photos, labels]);

    /**
     * **選んだ色が消えたら、選択そのものを捨てる。**
     * 写真が届いて一覧が入れ替わると、さっき選んだ色が最小枚数を割ることが
     * ある。`selected` を持ったままにすると、取り直し（`online` /
     * `visibilitychange`）で色が戻った瞬間に**押していないのにチップが
     * 光ってグリッドが開く**（レビューで指摘）。
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
        /**
         * 見出し（`<h2>`）にしない。この部品は `GalleryPageClient` の `<main>` と
         * `<h1>` より**前**に置かれるので、見出しにすると h2 → h1 の順になる。
         * 名前付きの region にして、題は見た目だけの行にする。
         */
        <section
            className="text-white bg-bg max-w-5xl mx-auto w-full px-4 sm:px-6 md:px-8"
            style={STYLE.section}
            aria-label="色でさがす"
        >
            <p style={STYLE.title}>色でさがす</p>
            <p className="text-white/50" style={STYLE.lead}>公開されている写真を、色から辿る</p>

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
                                    ? "bg-accent-fill text-white font-medium"
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
                            <span className={active ? "text-white text-[11px]" : "text-white/50 text-[11px]"}>
                                {inBucket.length}
                            </span>
                        </button>
                    );
                })}
            </div>

            {current ? (
                <div style={STYLE.grid}>
                    <GalleryGrid
                        photos={current.photos}
                        locale={locale}
                        categoryDisplayMap={categoryDisplayMap}
                        sizes={GRID_SIZES_5XL}
                    />
                </div>
            ) : null}
        </section>
    );
}
