"use client";

import React from "react";
import Link from "next/link";
import type { Photo } from "@/lib/data/photos";
import { collectEntries, collectionPath, collectionIndexPath, slugify, type CollectionEntry } from "@/lib/utils/collections";
import { dedupeCameraName } from "@/lib/utils/cameraName";
import Thumb from "../components/Thumb";
import { CHIP_OFF } from "@/app/components/chipStyles";
import { placeLine, placeParts } from "@/lib/utils/placeName";

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
    /**
     * 置き方。**数え方は同じで、並べ方と行き先が違う。**
     *
     *   `page` … 「さがす」の面の中（横いっぱい）。狭い画面は1行の
     *            横スクロール、**PC は折り返す**（横スクロールは指の作法で、
     *            マウスには掴む所が無い）。行き先は**集約ページ**
     *   `rail` … ホームの PC の右の柱。撮影地は**縦に並べた行**
     *            （150px のカードを2列にすると、柱の高さが画面を超えて
     *            貼り付かなくなる）。行き先は**「さがす」の検索結果**
     *            （owner の指示・`linkTo` の doc）
     */
};

/** 節に出す数（`page` は横スクロール1画面ぶん／`rail` は貼り付いたまま収まる高さ） */
const SHOWN = 8;

/** `collectEntries` と同じ規則でスラッグにする（写真の生の値から） */
function slugOf(raw: string, type: "category" | "location"): string {
    return slugify(raw, type);
}

/**
 * 行き先。**置き方で変える**（owner の指示・2026-09-22）。
 *
 *   `page` … 集約ページ（`/category/*` `/location/*` `/camera/*`）。
 *            検索に載せている面なので、内部リンクはそちらへ
 *   `rail` … **「さがす」の検索結果**（`/search?category=…` `/search?q=…`）。
 *            owner:「各項目を押したら『さがす』画面の該当する検索結果へ
 *            移動すること」。柱は**フィードの補助**なので、押した先も
 *            同じ「絞り込んで見る」体験に着地させる
 *
 * **新しい仕組みは作らない。** 集約ページ → 絞り込みの写像は
 * `resolveNotFoundRedirect` が既に1つ持っている（集約ページがまだ
 * 建っていないときの404救済に使っている経路で、`useGallery` の
 * `readFiltersFromUrl` が読む側）。**同じ関数をそのまま呼ぶ**ので、
 * 救済の行き先と柱の行き先が食い違うことが起きない。
 *
 * 撮影地と機材に専用の絞り込みが無く `?q=` に載るのも、あちらの判断のまま
 * （`useGallery` の検索対象に撮影地・カメラ名が入っているのが対）。
 */
function linkTo(type: "category" | "location" | "camera", slug: string): string {
    return collectionPath(type, slug);
}

/** その集約の代表写真（新しい順の先頭）。無ければ undefined */
function coverOf(photos: Photo[], match: (p: Photo) => boolean): Photo | undefined {
    return photos.find(match);
}

/**
 * 節の項目のリンク。**全部 `<Link>`。**
 *
 * 🔴 **以前はここだけ素の `<a>` にしていた。** `<Link>` で `/search?…` へ
 * 飛ぶとクエリが落ちて全件になっていたため（実測: `/search?category=landscape`
 * を直接ひらくと16枚・押すと `/search`・30枚）。
 *
 * 根っこは `useGallery` にあった——`history` の呼び出しを全部記録すると:
 *
 *     1889.6ms  pushState     /search?category=landscape   ← Next の <Link>
 *     1953.2ms  replaceState  /search                      ← useGallery が消す
 *
 * **URL は一度は正しくなっていた。** 消していたのは `urlFilters` の依存が
 * `[clientRender]` だけで、水和のときに一度読んだきり読み直さなかったから。
 * そちらを直した（`lib/hooks/useGallery.ts` の `subscribeToUrl`）ので、
 * 回避策は要らない。
 *
 * ⚠️ **戻したときの見張りは `useGallery` 側**（`urlFilters` が URL に追随する）。
 * ここを `<a>` に戻しても壊れはしないが、**押すたびに HTML を1本落とし直す**
 * （実測 gzip 15,477 B ／ `<Link>` の RSC の控えは 3,934 B）。
 */
function ItemLink({ href, className, style, children }: {
    href: string; className: string;
    style?: React.CSSProperties; children: React.ReactNode;
}) {
    return <Link href={href} prefetch={false} className={className} style={style}>{children}</Link>;
}

/**
 * 節の見出しと「すべて見る ›」。**`id` は見える `<h2>` に付ける。**
 *
 * 以前は `aria-labelledby` のために `sr-only` の `<h2>` を**同じ文字列で
 * もう1つ**置いていた。見た目は変わらないが、**読み上げでは同じ見出しが
 * 2回読まれる**（3節で6つ）。見える方に `id` を付ければ1つで足りる。
 *
 * 🔴 **「すべて見る ›」は一度 枠ごと落としてから、行き先を作って戻した。**
 *
 * 落とした理由: `href` を受け取る形で書いてあったのに、**3か所の呼び出しが
 * どれも渡していない**＝一度も描かれたことが無かった（実ビルドの
 * `out/search.html` に「すべて見る」は0件）。
 *
 * 戻した理由（2026-09-22・実ビルド151 HTML で数えた）:
 *
 *     トップ → /category/*   0本      トップ → /tag/*  49本
 *     トップ → /location/*   0本      （写真カードのタグのチップ）
 *     トップ → /camera/*     0本
 *
 * 柱の項目は owner の指示で `/search?…` を向いていて、その `/search` は
 * **`robots.txt` で `Disallow`**＝検索エンジンから見ると行き止まり。
 * つまり**トップは集約ページへリンクを1本も渡していなかった**。
 *
 * ⚠️ **枠だけ置かない**（落としたときと同じ形に戻さない）。行き先は
 * `collectionIndexPath` が返す**実在する索引ページ**（`app/category/page.tsx`
 * ほか）で、そこは `collectEntries` の全件を並べる＝「すべて見る」が本当。
 * 見張りは `DiscoverSections.test.tsx` の「見出しから索引ページへ行ける」。
 */
function SectionHead({ id, title, href, moreLabel }: {
    id: string; title: string; href: string; moreLabel: string;
}) {
    return (
        <div className="flex items-baseline justify-between mb-2.5">
            <h2 id={id} className="font-bold m-0" style={{ fontSize: "16px", lineHeight: "22px" }}>{title}</h2>
            {/* **先読みしない**（公開ページの `<Link>` は全部そう）。
                行き先は普通のページなので、項目と違って `<Link>` のままでよい
                ——クエリを持たないので `useGallery` の読み落としに当たらない */}
            <Link
                href={href}
                prefetch={false}
                className="flex-shrink-0 text-white/60 hover:text-white transition-colors"
                style={{ fontSize: "12px", touchAction: "manipulation" }}
            >
                {moreLabel}
            </Link>
        </div>
    );
}

export default function DiscoverSections({ photos, locale, categoryDisplayMap }: Props) {
    const isJa = locale !== "en";
    const more = isJa ? "すべて見る ›" : "See all ›";
    const shown = SHOWN;
    /**
     * 溢れの逃がし方。⚠️ **`overflow-x-auto` と `flex-wrap` は共存できない**
     * ので、`lg:` で `overflow-visible` へ戻してから折り返させる
     * （`FilterBar` の `WRAPPING_ROW` と同じ形）。柱は最初から折り返す。
     */
    const row = "flex gap-3 overflow-x-auto no-scrollbar lg:overflow-visible lg:flex-wrap";

    const categories = React.useMemo(() => collectEntries(photos, "category").slice(0, shown), [photos, shown]);
    const spots = React.useMemo(() => collectEntries(photos, "location").slice(0, shown), [photos, shown]);
    const cameras = React.useMemo(() => collectEntries(photos, "camera").slice(0, shown), [photos, shown]);

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
                    <SectionHead id="discover-categories" title={isJa ? "カテゴリからさがす" : "Browse by category"}
                                 href={collectionIndexPath("category")} moreLabel={more} />
                    <ul className={`${row} m-0 p-0`} style={{ listStyle: "none" }}>
                        {categories.map((c) => {
                            const cover = coverFor(c, "category");
                            return (
                                <li key={c.slug} className="flex-shrink-0">
                                    <ItemLink href={linkTo("category", c.slug)}
                                          className="block text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full"
                                          style={{ width: "72px", touchAction: "manipulation" }}>
                                        <span className="block relative rounded-full overflow-hidden bg-surface ring-1 ring-line"
                                              style={{ width: "72px", height: "72px" }}>
                                            {cover && <Thumb photo={cover} alt="" sizes="72px" />}
                                        </span>
                                        <span className="block mt-1.5 text-white truncate" style={{ fontSize: "12px" }}>
                                            {categoryDisplayMap[c.slug] ?? c.label}
                                        </span>
                                    </ItemLink>
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
                    <SectionHead id="discover-spots" title={isJa ? "写真の多い撮影地" : "Places with the most photos"}
                                 href={collectionIndexPath("location")} moreLabel={more} />
                    <ul className={`${row} m-0 p-0`} style={{ listStyle: "none" }}>
                        {spots.map((s) => {
                            const cover = coverFor(s, "location");
                            return (
                                <li key={s.slug} className="flex-shrink-0">
                                    <ItemLink href={linkTo("location", s.slug)}
                                          className="block rounded-xl overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                          style={{ width: "150px", touchAction: "manipulation" }}>
                                        <span className="block relative bg-surface ring-1 ring-line rounded-xl overflow-hidden"
                                              style={{ width: "150px", height: "100px" }}>
                                            {cover && <Thumb photo={cover} alt="" sizes="150px" />}
                                        </span>
                                        {/* **見出しは具体的な部分だけ**、地域は2行目に（長い住所を
                                            見出しにしない・地域の束と場所を見分ける・`placeParts`） */}
                                        <span className="block mt-1.5 text-white truncate" style={{ fontSize: "13px" }} title={s.label}>{placeParts(s.label).title}</span>
                                        <span className="block text-white/70 truncate" style={{ fontSize: "12px" }}>
                                            {placeLine(s.label, isJa)}{isJa ? `${s.count}枚` : `${s.count} photos`}
                                        </span>
                                    </ItemLink>
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
                    <SectionHead id="discover-cameras" title={isJa ? "機材からさがす" : "Browse by camera"}
                                 href={collectionIndexPath("camera")} moreLabel={more} />
                    <ul className="flex flex-wrap gap-2 m-0 p-0" style={{ listStyle: "none" }}>
                        {cameras.map((c) => (
                            <li key={c.slug}>
                                <ItemLink href={linkTo("camera", c.slug)}
                                      className={`inline-flex items-center gap-1.5 rounded-full ${CHIP_OFF} transition-colors`}
                                      style={{ fontSize: "12px", lineHeight: "16px", padding: "5px 11px", touchAction: "manipulation" }}>
                                    {dedupeCameraName(c.label)}
                                    <span className="text-white/60" style={{ fontSize: "11px" }}>{c.count}</span>
                                </ItemLink>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
