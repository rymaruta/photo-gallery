"use client";

import React from "react";
import Link from "next/link";
import GalleryGrid from "./GalleryGrid";
import SectionHead from "./SectionHead";
import { EDITORIAL_HERO_SIZES, EDITORIAL_PAIR_SIZES } from "./gridSizes";
import { CHIP_OFF, CHIP_ON, CHIP_SIZE, CHIP_HIT, CHIP_ROW } from "./chipStyles";
import { useLocale } from "../i18n/context";
import type { Photo } from "@/lib/data/photos";
import type { CollectionType } from "@/lib/utils/collections";
import { COLLECTION_SORTS, sortForCollection, type CollectionSort } from "@/lib/utils/photoOrder";

type RelatedLink = { label: string; count: number; path: string };

type Props = {
    photos: Photo[];
    heading: string;
    description: string;
    breadcrumb: string;
    // **型を書き下さない。** 種類が増えたときにここだけ古いままになる
    // （`camera` を足したとき実際に tsc が止めた）
    type?: CollectionType;
    related?: RelatedLink[];
    /** 写真が少ないページにだけ出す「ほかにこんな写真も」 */
    nearby?: Photo[];
};

const RELATED_HEADING: Record<CollectionType, { ja: string; en: string }> = {
    tag: { ja: "関連タグ", en: "Related tags" },
    location: { ja: "他の撮影地", en: "More locations" },
    category: { ja: "他のカテゴリ", en: "More categories" },
    camera: { ja: "他のカメラ", en: "More cameras" },
};

/**
 * 題の上の眉（iOS の `CollectionScreen.eyebrow(for:)`・板 TagPhotos の「TAG」）。**何で集めた一覧か**を先に読ませる。
 * 英字の飾りなので読み上げには出さない（題が同じことを日本語で言う）
 */
export const COLLECTION_EYEBROW: Record<CollectionType, string> = {
    tag: "TAG",
    location: "PLACE",
    category: "CATEGORY",
    camera: "CAMERA",
};

/** 並べ替えのチップの名前（iOS の `GallerySort.chipLabel`） */
const SORT_LABEL: Record<CollectionSort, { ja: string; en: string }> = {
    popular: { ja: "人気", en: "Popular" },
    new: { ja: "新着", en: "New" },
    taken: { ja: "撮影日", en: "Date taken" },
};

/**
 * タグ/場所/カテゴリ/カメラの集約ページ本体（iOS の `CollectionPhotosScreen`・板 12 にそろえた・2026-10-31 束 2）。
 *
 *     眉（真鍮・TAG など）→ 明朝 32 の題 → 13 の枚数（等幅の数字）
 *     説明文（15・text-2。iOS の `lede` の場所。検索に載せる文なので Web は残す）
 *     並べ替えのチップ（人気・新着・撮影日。既定は人気＝iOS と同じ）
 *     写真の並び（大きく1枚 → 2枚 → 2枚・`GalleryGrid` の `editorial`）
 *
 * 2026-10-31 判断: **パンくずは残す**（iOS には無い）。構造化データ（BreadcrumbList）が指す見える道で、
 * 「ホーム」への内部リンクでもある。見た目だけ静かに（12・text-3）して題より目立たせない。
 * 以前は 14px のゴシックの題・白70% の説明と括弧の枚数・4:3 の2列の格子だった。
 */
export default function CollectionPageClient({ photos, heading, description, breadcrumb, type = "tag", related = [], nearby = [] }: Props) {
    const { locale } = useLocale();
    const en = locale === "en";
    const [sort, setSort] = React.useState<CollectionSort>("popular");
    const sorted = React.useMemo(() => sortForCollection(photos, sort), [photos, sort]);
    const count = photos.length;

    return (
        <main className="mx-auto max-w-6xl px-4 pt-4 pb-8">
            <nav aria-label="パンくずリスト" className="mb-3 text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }} data-testid="collection-breadcrumb">
                <Link href="/" prefetch={false} className="hover:text-white">ホーム</Link>
                <span className="mx-1.5" aria-hidden>/</span>
                <span>{breadcrumb}</span>
            </nav>

            {/* 見出し（iOS の `heading`: 眉 → 題 → 枚数。間 4） */}
            <header className="flex flex-col gap-1 mb-3" data-testid="collection-heading">
                <p aria-hidden="true" className="m-0 eyebrow text-accent">{COLLECTION_EYEBROW[type]}</p>
                <h1 className="m-0 font-serif font-bold text-white line-clamp-2" style={{ fontSize: "32px", lineHeight: 1.25 }}>{heading}</h1>
                <p className="m-0 text-text-2 tabular-nums" style={{ fontSize: "13px", lineHeight: "18px" }} data-testid="collection-count">
                    {en ? `${count} ${count === 1 ? "photo" : "photos"}` : `${count}枚`}
                </p>
            </header>
            <p className="m-0 mb-3 text-text-2" style={{ fontSize: "15px", lineHeight: 1.6 }}>{description}</p>

            {/* 並べ替え（iOS の `PillChip` の横の並び）。写真が1枚なら並べ替えても同じなので出さない */}
            {count > 1 && (
                <div role="group" aria-label={en ? "Sort" : "並べ替え"} className={`${CHIP_ROW} mb-3`} data-testid="collection-sort">
                    {COLLECTION_SORTS.map((s) => (
                        <button
                            key={s}
                            type="button"
                            aria-pressed={sort === s}
                            onClick={() => setSort(s)}
                            className={`${CHIP_HIT} inline-flex items-center justify-center rounded-full transition-colors ${sort === s ? CHIP_ON : CHIP_OFF}`}
                            style={{ ...CHIP_SIZE, touchAction: "manipulation" }}
                        >
                            {SORT_LABEL[s][en ? "en" : "ja"]}
                        </button>
                    ))}
                </div>
            )}

            <GalleryGrid photos={sorted} locale={locale} layout="editorial" sizes={EDITORIAL_PAIR_SIZES} heroSizes={EDITORIAL_HERO_SIZES} />

            {/* **写真が少ないページにだけ。** 1枚だけのページは、それ自体は
                このサイトにしか無い写真でも「見るものが1つ」で終わる。
                近い写真を出すと読む価値が出て、押せば個別ページへ回遊する。
                節の見出しは iOS の `SpotDetailParts.sectionHeader`（眉なし・明朝 22） */}
            {nearby.length > 0 && (
                <section aria-labelledby="collection-nearby" className="mt-8">
                    <SectionHead id="collection-nearby" title={en ? "You might also like" : "ほかにこんな写真も"} />
                    <GalleryGrid photos={nearby} locale={locale} layout="editorial" sizes={EDITORIAL_PAIR_SIZES} heroSizes={EDITORIAL_HERO_SIZES} />
                </section>
            )}

            {/* 同タイプの他ページへの相互リンク（回遊・SEO）。押せるチップ（`chipStyles`） */}
            {related.length > 0 && (
                <section aria-labelledby="collection-related" className="mt-8">
                    <SectionHead id="collection-related" title={RELATED_HEADING[type]?.[en ? "en" : "ja"] ?? "関連ページ"} />
                    <ul className={CHIP_ROW} data-testid="collection-related">
                        {related.map((r) => (
                            // **先読みしない。** 一覧で何本も出るリンクなので、画面に入るたびに
                            // 行き先の RSC の控え（`no-store` 配信）を落とし直す。理由と実測は
                            // `app/components/GalleryGrid.tsx` のカードのコメントに書いた
                            <li key={r.path} className="m-0 p-0">
                                <Link
                                    href={r.path}
                                    prefetch={false}
                                    className={`${CHIP_HIT} inline-flex items-center gap-1.5 rounded-full transition-colors ${CHIP_OFF}`}
                                    style={{ ...CHIP_SIZE, touchAction: "manipulation" }}
                                >
                                    {type === "tag" ? `#${r.label}` : r.label}
                                    <span className="text-white/60 tabular-nums" style={{ fontSize: "12px" }}>{r.count}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </main>
    );
}
