"use client";

import React from "react";
import Link from "next/link";
import type { Photo } from "@/lib/data/photos";
import { collectEntries, collectionPath, slugify, type CollectionEntry } from "@/lib/utils/collections";
import { dedupeCameraName } from "@/lib/utils/cameraName";
import Thumb from "../components/Thumb";

/**
 * 「さがす」の発見の面（最終版モックの中段・owner の指示書 7）。
 *
 * **実データが無い節は丸ごと出さない。** 指示書:「デザイン画像に描かれている
 * 架空の統計、写真件数、フォロワー数、人気順位、レビュー、評価…は、実際の
 * データが存在しない限り表示しないでください」「人気スポットは、実際の集計
 * データが存在する場合にのみ人気として表示してください」。
 *
 * だからモックの節のうち、ここで作るのは**数えられるものだけ**:
 *
 * | モックの節 | 実装 | 理由 |
 * |---|---|---|
 * | カテゴリの丸いチップ | ✅ そのカテゴリの最新の1枚を絵にする | `category` は実データにある |
 * | 撮影スポット | ✅ 撮影地を**枚数順**に（「人気」とは呼ばない） | 集計は枚数だけ。閲覧数も保存数も数えていない |
 * | 機材から探す | ✅ 機種別（`/camera/*`） | 広角/標準/望遠は**35mm換算が要る**——保存しているのは実焦点距離で、センサーの大きさが分からない。分けると嘘になる |
 * | 注目スポット・今週末に行きたい場所 | ❌ | 運営が選ぶ仕組みも、行きたい数の公開集計も無い |
 * | 色から探す | 別部品（`ColorJourney`） | |
 *
 * 数え方は**本体の関数をそのまま使う**（`collectEntries`）。撮影地の緩い一致
 * （「パリ」と「パリ, フランス」）もあちらが持っている——自前で数え直すと、
 * チップの数と飛んだ先の枚数が食い違う。
 */
type Props = {
    /** 絞り込み前の全写真（節は「いま何があるか」を出す面なので、絞り込みに連動させない） */
    photos: Photo[];
    locale: string;
    /** カテゴリのスラッグ → 表示名（`GalleryPageClient` が持っているものをそのまま） */
    categoryDisplayMap: Record<string, string>;
};

/** 節に出す数（横スクロール1画面ぶん） */
const SHOWN = 8;

/** `collectEntries` と同じ規則でスラッグにする（写真の生の値から） */
function slugOf(raw: string, type: "category" | "location"): string {
    return slugify(raw, type);
}

/** その集約の代表写真（新しい順の先頭）。無ければ undefined */
function coverOf(photos: Photo[], match: (p: Photo) => boolean): Photo | undefined {
    return photos.find(match);
}

function SectionHead({ title, href, moreLabel }: { title: string; href?: string; moreLabel: string }) {
    return (
        <div className="flex items-baseline justify-between mb-2.5">
            <h2 className="font-bold m-0" style={{ fontSize: "16px", lineHeight: "22px" }}>{title}</h2>
            {href && (
                <Link href={href} prefetch={false} className="text-link hover:text-white transition-colors"
                      style={{ fontSize: "12px", touchAction: "manipulation" }}>
                    {moreLabel}
                </Link>
            )}
        </div>
    );
}

export default function DiscoverSections({ photos, locale, categoryDisplayMap }: Props) {
    const isJa = locale !== "en";
    const more = isJa ? "すべて見る ›" : "See all ›";

    const categories = React.useMemo(() => collectEntries(photos, "category").slice(0, SHOWN), [photos]);
    const spots = React.useMemo(() => collectEntries(photos, "location").slice(0, SHOWN), [photos]);
    const cameras = React.useMemo(() => collectEntries(photos, "camera").slice(0, SHOWN), [photos]);

    // 代表写真は**スラッグで突き合わせる**（生の値だと別名で保存された写真に当たらない）
    const coverFor = React.useCallback((entry: CollectionEntry, type: "category" | "location") =>
        coverOf(photos, (p) => {
            const raw = type === "category" ? p.category : p.location;
            if (typeof raw !== "string" || !raw) return false;
            return collectionPath(type, entry.slug) === collectionPath(type, slugOf(raw, type));
        }), [photos]);

    if (categories.length === 0 && spots.length === 0 && cameras.length === 0) return null;

    return (
        <div className="space-y-6 mb-6">
            {categories.length > 0 && (
                <section aria-labelledby="discover-categories">
                    <SectionHead title={isJa ? "カテゴリからさがす" : "Browse by category"} moreLabel={more} />
                    <h2 id="discover-categories" className="sr-only">{isJa ? "カテゴリからさがす" : "Browse by category"}</h2>
                    <ul className="flex gap-3 overflow-x-auto no-scrollbar m-0 p-0" style={{ listStyle: "none" }}>
                        {categories.map((c) => {
                            const cover = coverFor(c, "category");
                            return (
                                <li key={c.slug} className="flex-shrink-0">
                                    <Link href={collectionPath("category", c.slug)} prefetch={false}
                                          className="block text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full"
                                          style={{ width: "72px", touchAction: "manipulation" }}>
                                        <span className="block relative rounded-full overflow-hidden bg-surface ring-1 ring-line"
                                              style={{ width: "72px", height: "72px" }}>
                                            {cover && <Thumb photo={cover} alt="" sizes="72px" />}
                                        </span>
                                        <span className="block mt-1.5 text-white truncate" style={{ fontSize: "12px" }}>
                                            {categoryDisplayMap[c.slug] ?? c.label}
                                        </span>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {spots.length > 0 && (
                <section aria-labelledby="discover-spots">
                    {/* **「人気」とは呼ばない。** 数えているのは投稿の枚数だけで、
                        閲覧数も保存数も持っていない（指示書 7） */}
                    <SectionHead title={isJa ? "写真の多い撮影地" : "Places with the most photos"} moreLabel={more} />
                    <h2 id="discover-spots" className="sr-only">{isJa ? "写真の多い撮影地" : "Places with the most photos"}</h2>
                    <ul className="flex gap-3 overflow-x-auto no-scrollbar m-0 p-0" style={{ listStyle: "none" }}>
                        {spots.map((s) => {
                            const cover = coverFor(s, "location");
                            return (
                                <li key={s.slug} className="flex-shrink-0">
                                    <Link href={collectionPath("location", s.slug)} prefetch={false}
                                          className="block rounded-xl overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                          style={{ width: "150px", touchAction: "manipulation" }}>
                                        <span className="block relative bg-surface ring-1 ring-line rounded-xl overflow-hidden"
                                              style={{ width: "150px", height: "100px" }}>
                                            {cover && <Thumb photo={cover} alt="" sizes="150px" />}
                                        </span>
                                        <span className="block mt-1.5 text-white truncate" style={{ fontSize: "13px" }}>{s.label}</span>
                                        <span className="block text-white/60" style={{ fontSize: "11px" }}>
                                            {isJa ? `${s.count}枚` : `${s.count} photos`}
                                        </span>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {cameras.length > 0 && (
                <section aria-labelledby="discover-cameras">
                    {/* **「広角・標準・望遠」にはしない。** 保存しているのは実焦点距離で、
                        センサーの大きさを持っていない＝35mm換算に直せない。
                        APS-C の 28mm を「広角」と出すと嘘になる（指示書: 実際のデータが
                        存在しない限り表示しない） */}
                    <SectionHead title={isJa ? "機材からさがす" : "Browse by camera"} moreLabel={more} />
                    <h2 id="discover-cameras" className="sr-only">{isJa ? "機材からさがす" : "Browse by camera"}</h2>
                    <ul className="flex flex-wrap gap-2 m-0 p-0" style={{ listStyle: "none" }}>
                        {cameras.map((c) => (
                            <li key={c.slug}>
                                <Link href={collectionPath("camera", c.slug)} prefetch={false}
                                      className="inline-flex items-center gap-1.5 rounded-full bg-chip text-chip-text ring-1 ring-line hover:bg-surface-2 hover:text-white transition-colors"
                                      style={{ fontSize: "12px", lineHeight: "16px", padding: "5px 11px", touchAction: "manipulation" }}>
                                    {dedupeCameraName(c.label)}
                                    <span className="text-white/50" style={{ fontSize: "11px" }}>{c.count}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
