"use client";

import React from "react";
import Link from "next/link";
import type { Photo, Locale } from "@/lib/data/photos";
import {
    collectEntries, collectionPath, collectionIndexPath, slugify, isIndexableCollection, type CollectionEntry,
} from "@/lib/utils/collections";
import { dedupeCameraName } from "@/lib/utils/cameraName";
import { resolveNotFoundRedirect } from "@/lib/utils/notFoundRedirect";
import Thumb from "./Thumb";
import { CHIP_OFF } from "./chipStyles";

/**
 * ホームの PC の右の柱＝**写真で見つける発見エリア**。
 *
 * ## なぜ `DiscoverSections` と別の部品なのか
 *
 * `DiscoverSections` は**「さがす」の面**（`variant="page"`）と柱
 * （`variant="rail"`）を1つで賄っていたが、柱の方だけ「文字の一覧」に
 * 見えていた（小さい 56px の四角＋文字の行・文字チップ）。
 * owner:「右側の DiscoverSections を、写真を使った視覚的な発見エリアへ
 * 再設計する」。**面の方は変えない**ので、柱だけを別部品にした。
 *
 * ⚠️ **`DiscoverSections.tsx` には1文字も触っていない。** あのファイルは
 * **PR #141（検索URLの同期）が書き換えている最中**で、触ると
 * 「現在 Open の PR の修正を巻き戻さない」に反する。
 *
 * ## 数え方と行き先は1か所のまま
 *
 * `collectEntries` / `collectionPath` / `resolveNotFoundRedirect` を
 * **そのまま使う**（`DiscoverSections` と同じ関数）。自前で数え直すと、
 * 柱の枚数と飛んだ先の枚数が食い違う（撮影地は「緩い一致」で数えるため）。
 *
 * ## リンクは `<Link prefetch={false}>`
 *
 * 🔴 **この部品は素の `<a>` のまま本番に出ていた（2026-09-24）。**
 * 書かれた当時（9/23）は「`/search?…` へ `<Link>` で飛ぶとクエリが落ちて
 * 全件になる」ので素の `<a>` にしてあり、**このコメント自身が
 * 「#141 が入ったら `<Link>` に寄せる」と書いていた**。
 * #141 は **9/23 に本番反映済み**（`55d27db3`）で、面の中
 * （`DiscoverSections`）は既に `<Link>` に直っている——**この枝だけが
 * 取り残され、そのまま出た**。
 *
 * 代償は `DiscoverSections` が実測して書いている:
 * **押すたびに HTML を1本落とし直す（gzip 15,477 B ／ `<Link>` の
 * RSC の控えは 3,934 B）。**
 *
 * ⚠️ **守りが死んだ側に残っていたので、誰も捕まえられなかった。**
 * 「柱も `<Link>`」を見るテストは `DiscoverSections` の
 * `variant="rail"`（もう本体から呼ばれない）側に在った。
 * **コードを移したら、守りも一緒に移す。**
 *
 * `prefetch={false}` は公開ページの決まり（`app/__tests__/linkPrefetch.test.ts`）。
 *
 * ## 出さないもの
 *
 * 架空の数字は1つも出さない（owner の指示書）。ここに出るのは
 * **カテゴリ・撮影地・機材・タグと、その実際の枚数**だけ。
 *
 * ## タグは検索に載るページへの内部リンク（2026-09-29）
 *
 * ホームの新着を iOS と同じ写真の並び（`HomeMosaic`）にして、カードに付いていた
 * タグのリンクが消えた。**検索に載るタグページ（`isIndexableCollection`）8本への
 * リンクがホームから全部なくなった**ので、ここで持つ。**載らないタグは出さない**
 * （薄いページへ内部リンクを集めない）。行き先は `/search` へ振り替えず、タグページそのもの。
 * 撮影地・カテゴリ・機材は owner の指示（2026-09-22）で `/search` へ振り替えているが、
 * タグは**集約ページへの内部リンクそのものが目的**なので分けた。
 * **「すべて見る」は出さない**——タグの索引ページ（`/tag`）は作っていない
 * （`collectionIndexPath` の注記・サイトマップも3種だけ）。出すと全訪問者に 404 へのリンクになる。
 * ⚠️ 柱は高さに収める箱で、よくある PC の画面（1280×800 など）ではこの節は中を送らないと
 * 見えない（前から撮影地〜機材で箱からあふれている）。リンクとしては HTML にあるので検索には効く
 */
type Props = {
    /** 絞り込み前の全写真（柱は「いま何があるか」を出す面なので、絞り込みに連動させない） */
    photos: Photo[];
    locale: Locale;
    /** カテゴリのスラッグ → 表示名（`GalleryPageClient` が持っているものをそのまま） */
    categoryDisplayMap: Record<string, string>;
};

/** 柱に出す数。**多くしない**——柱は画面の高さに収める箱で、中で送らせたくない */
const SHOWN_SPOTS = 4;
const SHOWN_CATEGORIES = 4;
const SHOWN_CAMERAS = 4;
/** タグは**検索に載るものだけ**なので、上限はその数に任せる（今は8つ） */
const SHOWN_TAGS = 12;

/** `collectEntries` と同じ規則でスラッグにする（写真の生の値から） */
function keyOf(photo: Photo, type: "category" | "location" | "camera"): string {
    if (type === "category") return slugify(photo.category ?? "", "category");
    if (type === "location") return slugify(photo.location ?? "", "location");
    return slugify(dedupeCameraName(photo.exif?.camera) ?? "", "camera");
}

/** その集約の代表写真（新しい順の先頭）。無ければ undefined */
function coverOf(photos: Photo[], type: "category" | "location" | "camera", slug: string): Photo | undefined {
    return photos.find((p) => keyOf(p, type) === slug);
}

/**
 * 行き先。**「さがす」の検索結果へ振り替える**（owner の指示・2026-09-22）。
 * 写像は 404 救済が持っている1本（`resolveNotFoundRedirect`）を使い回す
 * ので、救済の行き先と柱の行き先が食い違わない。
 */
function linkTo(type: "category" | "location" | "camera", slug: string): string {
    const path = collectionPath(type, slug);
    return resolveNotFoundRedirect(path) ?? path;
}

/**
 * 節の見出し。**セリフ体＋細い罫**。
 *
 * ブランドの声はヘッダーのロゴが既に決めている（`font-serif`）ので、
 * **新しい字体は持ち込まない**——同じ `font-serif` を見出しに使うだけ。
 */
function RailHead({ id, title, href, more }: { id: string; title: string; href?: string; more: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3 mb-2.5">
            <h2 id={id} className="m-0 font-serif font-bold text-white tracking-wide"
                style={{ fontSize: "15px", lineHeight: "20px" }}>
                {title}
            </h2>
            {/* 行き先の無い節（タグ）は「すべて見る」を出さない */}
            {href && (
                <Link href={href} prefetch={false}
                   className="flex-shrink-0 text-white/55 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                   style={{ fontSize: "11px", lineHeight: "16px" }}>
                    {more} <span aria-hidden="true">›</span>
                </Link>
            )}
        </div>
    );
}

export default function DiscoverRail({ photos, locale, categoryDisplayMap }: Props) {
    const isJa = locale !== "en";
    const more = isJa ? "すべて見る" : "See all";

    const categories = React.useMemo(
        () => collectEntries(photos, "category").slice(0, SHOWN_CATEGORIES), [photos]);
    const spots = React.useMemo(
        () => collectEntries(photos, "location").slice(0, SHOWN_SPOTS), [photos]);
    const cameras = React.useMemo(
        () => collectEntries(photos, "camera").slice(0, SHOWN_CAMERAS), [photos]);
    const tags = React.useMemo(
        () => collectEntries(photos, "tag").filter((e) => isIndexableCollection(e.count, "tag")).slice(0, SHOWN_TAGS), [photos]);

    const cover = React.useCallback(
        (type: "category" | "location" | "camera", e: CollectionEntry) => coverOf(photos, type, e.slug),
        [photos]);

    return (
        <div className="flex flex-col gap-7">
            {/* ── 撮影地: 写真のタイル ───────────────────────────────
                前は 56px の四角＋文字の行だった。**この柱でいちばん
                「旅」が伝わるのは地名ではなく写真**なので、2列のタイルにして
                名前と枚数を写真の上に置く */}
            {spots.length > 0 && (
                <section aria-labelledby="rail-spots">
                    {/* **「人気」とは呼ばない。** 数えているのは投稿の枚数だけ */}
                    <RailHead id="rail-spots" title={isJa ? "撮影地からさがす" : "By place"}
                              href={collectionIndexPath("location")} more={more} />
                    <ul className="grid grid-cols-2 gap-2 m-0 p-0" style={{ listStyle: "none" }}>
                        {spots.map((s) => {
                            const c = cover("location", s);
                            return (
                                <li key={s.slug}>
                                    <Link href={linkTo("location", s.slug)} prefetch={false}
                                       className="group block relative overflow-hidden rounded-xl bg-surface ring-1 ring-line focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                       style={{ aspectRatio: "1 / 1", touchAction: "manipulation" }}>
                                        {c && <Thumb photo={c} alt="" sizes="200px" />}
                                        <span aria-hidden="true"
                                              className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
                                        <span className="absolute inset-x-0 bottom-0 p-2">
                                            <span className="block text-white font-medium truncate"
                                                  style={{ fontSize: "12px", lineHeight: "16px" }}>{s.label}</span>
                                            <span className="block text-white/70"
                                                  style={{ fontSize: "10px", lineHeight: "14px" }}>
                                                {isJa ? `${s.count}枚` : `${s.count} photos`}
                                            </span>
                                        </span>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {/* ── カテゴリ: 丸い写真 ─────────────────────────────── */}
            {categories.length > 0 && (
                <section aria-labelledby="rail-categories">
                    <RailHead id="rail-categories" title={isJa ? "カテゴリからさがす" : "By category"}
                              href={collectionIndexPath("category")} more={more} />
                    <ul className="grid grid-cols-4 gap-2 m-0 p-0" style={{ listStyle: "none" }}>
                        {categories.map((c) => {
                            const cv = cover("category", c);
                            return (
                                <li key={c.slug}>
                                    <Link href={linkTo("category", c.slug)} prefetch={false}
                                       className="block text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full"
                                       style={{ touchAction: "manipulation" }}>
                                        <span className="block relative rounded-full overflow-hidden bg-surface ring-1 ring-line mx-auto"
                                              style={{ width: "64px", height: "64px" }}>
                                            {cv && <Thumb photo={cv} alt="" sizes="64px" />}
                                        </span>
                                        <span className="block mt-1.5 text-white truncate"
                                              style={{ fontSize: "11px", lineHeight: "15px" }}>
                                            {categoryDisplayMap[c.slug] ?? c.label}
                                        </span>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {/* ── 機材: 文字のチップのまま ─────────────────────────
                **写真にしない。** 機材に紐づく代表写真は「その機材で撮った1枚」
                でしかなく、機材そのものの絵ではない。丸くすると撮影地・
                カテゴリと同じ重さに見えて、写真の意味が3種類に割れる */}
            {cameras.length > 0 && (
                <section aria-labelledby="rail-cameras">
                    <RailHead id="rail-cameras" title={isJa ? "機材からさがす" : "By camera"}
                              href={collectionIndexPath("camera")} more={more} />
                    <ul className="flex flex-wrap gap-1.5 m-0 p-0" style={{ listStyle: "none" }}>
                        {cameras.map((c) => (
                            <li key={c.slug}>
                                <Link href={linkTo("camera", c.slug)} prefetch={false}
                                   className={`inline-flex items-center gap-1.5 rounded-full ${CHIP_OFF} transition-colors`}
                                   style={{ fontSize: "12px", lineHeight: "16px", padding: "5px 10px", touchAction: "manipulation" }}>
                                    {c.label}
                                    <span className="text-white/60" style={{ fontSize: "10px" }}>{c.count}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* ── タグ: 検索に載るタグページへ（機材と同じ文字のチップ） ── */}
            {tags.length > 0 && (
                <section aria-labelledby="rail-tags">
                    <RailHead id="rail-tags" title={isJa ? "タグからさがす" : "By tag"} more={more} />
                    <ul className="flex flex-wrap gap-1.5 m-0 p-0" style={{ listStyle: "none" }}>
                        {tags.map((t) => (
                            <li key={t.slug}>
                                <Link href={collectionPath("tag", t.slug)} prefetch={false}
                                   className={`inline-flex items-center gap-1.5 rounded-full ${CHIP_OFF} transition-colors`}
                                   style={{ fontSize: "12px", lineHeight: "16px", padding: "5px 10px", touchAction: "manipulation" }}>
                                    #{t.label.replace(/^#/, "")}
                                    <span className="text-white/60" style={{ fontSize: "10px" }}>{t.count}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
