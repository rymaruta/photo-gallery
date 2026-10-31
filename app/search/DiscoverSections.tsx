"use client";

import React from "react";
import Link from "next/link";
import type { Photo } from "@/lib/data/photos";
import { collectEntries, collectionPath, collectionIndexPath, slugify, type CollectionEntry } from "@/lib/utils/collections";
import Thumb from "../components/Thumb";
import SharedSectionHead from "../components/SectionHead";
import { placeParts } from "@/lib/utils/placeName";
import { CameraIcon } from "@heroicons/react/24/outline";
import { featuredGroups } from "@/lib/utils/featured";
import { colorShelves, gearShelves, COLOR_TEXT, GEAR_TEXT } from "@/lib/utils/searchShelves";
import { photoAltText } from "@/lib/utils/photoAlt";
import { ROUTES } from "@/lib/routes";
import GalleryGrid from "../components/GalleryGrid";
import { GRID_SIZES_SEARCH, GRID_COLUMNS_SEARCH } from "../components/gridSizes";

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
 * | 機材から探す | ✅ 広角・標準・望遠（iOS の `GearGroups`・実焦点距離で分ける。範囲を札に出して隠さない）＋機種別の索引（`/camera`） | 2026-10-31 束 1 S7: 以前は「35mm換算が無いので分けると嘘」として機種名だけだった。iOS 1.1.48 が範囲を明示して分けたので合わせた |
 * | 注目スポット・今週末に行きたい場所 | ❌ | 運営が選ぶ仕組みも、行きたい数の公開集計も無い |
 * | 色から探す | ✅ iOS の `ColorFamilies`（空・海…の 5 つ・外の景色の分類だけ）`searchShelves.ts` | |
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
 *
 * **形はアプリ v2 の節の見出し**（iOS の `JPSectionHeading`・板 Search の `.sh`・2026-10-15）:
 * 眉（真鍮の英字＋右へ消える線）→ 6 → 明朝 22 の題、右下に「すべて見る ›」（13・灰・当たり 44）。
 * 以前は 16px のゴシックの太字で、アプリと別の画面に見えた。
 * 眉は英字の飾りなので読み上げに出さない（題が同じことを日本語で言う）。
 * 「すべて見る」を真鍮にしない——節の行き先は合図ではなく道（iOS の `MoreLink` と同じ）。
 */
function SectionHead(props: { id: string; eyebrow: string; title: string; href: string; moreLabel: string }) {
    // 形はホームの「おすすめ」と共通の部品（`app/components/SectionHead.tsx`）
    return <SharedSectionHead {...props} testId="discover-section-head" />;
}

/**
 * 2026-10-31 判断（束 1 S4・S5・S7・S8・iOS の `SearchView` の発見の面）: **iOS の順と形に寄せる**。
 *
 *     撮影地（写真の多い撮影地・地図で見る ›）  156×116・角 14・名前は写真の上（明朝 18）・枚数なし・国だけの札は出さない
 *     おすすめ（PICKS · カテゴリ）             owner が選んだ写真 120×160・角 10 の横の帯（カテゴリの頁へ「すべて見る」）
 *     色から探す（COLORS）                   写真の丸 62＋題材の名前（空・海…）を 5 等分で左から。押すとその色の写真
 *     機材から探す（GEAR）                   札 3 枚（広角・標準・望遠・〜35mm…）。押すとその焦点距離の写真
 *
 * 以前は カテゴリの丸 6 つ → 撮影地の札（「地域・5枚」）→ 機種名のチップ の順で、色は別の部品（`ColorJourney`）の
 * 色の点＋件数のチップだった。カテゴリの丸は、何かを探しはじめたときのチップ（`FilterBar` の `layout="search"`）へ。
 * 機種名で探す行き先（`/camera/*`）は機材の節の「機種で見る ›」（機材の索引）に残す（内部リンク＝SEO）。
 * iOS の「いまの季節の写真」「季節・時間帯から探す」は Web に無い機能（台帳の束 6）なので足さない。
 *
 * 色と機材は iOS では別の画面へ進むが、Web は**押した棚の写真をその場に開く**（押し直すと閉じる・
 * 以前の `ColorJourney` と同じ開き方）。写真の行き先・開き方は下の結果の格子と同じ（`onOpenPhoto`）
 */
export default function DiscoverSections({ photos, locale, categoryDisplayMap, onOpenPhoto }: Props & {
    /** 静的ページの無い新着写真をその場で開く（下の格子と同じもの） */
    onOpenPhoto?: (photoId: string) => boolean;
}) {
    const isJa = locale !== "en";
    const more = isJa ? "すべて見る" : "See all";
    const row = "flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 lg:overflow-visible lg:flex-wrap";

    // 撮影地: 枚数の多い順（数え方は集約ページと同じ `collectEntries`）。**国だけの撮影地は出さない**（iOS の `spotName`）
    const spots = React.useMemo(
        () => {
            // **同じ名前の札は1枚にまとめる**（iOS の `popularSpots`・「パリ」と「パリ, フランス」を2枚の「パリ」にしない）。
            // 先に来た（枚数の多い）方の行き先を使う
            const seen = new Set<string>();
            return collectEntries(photos, "location")
                .filter((e) => placeParts(e.label).kind !== "country")
                .filter((e) => {
                    const key = placeParts(e.label).title.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .slice(0, SHOWN);
        },
        [photos],
    );
    const featured = React.useMemo(() => featuredGroups(photos, categoryDisplayMap)[0] ?? null, [photos, categoryDisplayMap]);
    const colors = React.useMemo(() => colorShelves(photos), [photos]);
    const gear = React.useMemo(() => gearShelves(photos), [photos]);
    const [open, setOpen] = React.useState<string | null>(null);

    const coverFor = React.useCallback((entry: CollectionEntry) =>
        coverOf(photos, (p) => {
            if (typeof p.location !== "string" || !p.location) return false;
            return collectionPath("location", entry.slug) === collectionPath("location", slugOf(p.location, "location"));
        }), [photos]);

    if (spots.length === 0 && !featured && colors.length === 0 && gear.length === 0) return null;

    const openShelf = open?.startsWith("color:")
        ? colors.find((c) => `color:${c.family}` === open)?.photos
        : open?.startsWith("gear:") ? gear.find((g) => `gear:${g.group}` === open)?.photos : undefined;

    return (
        <div className="flex flex-col gap-8 mb-8" data-testid="discover-sections">
            {spots.length > 0 && (
                <section aria-labelledby="discover-spots">
                    {/* **「人気」とは呼ばない。** 数えているのは投稿の枚数だけで、閲覧数も保存数も持っていない（指示書 7） */}
                    <SectionHead id="discover-spots" eyebrow="PLACES" title={isJa ? "写真の多い撮影地" : "Places with the most photos"}
                                 href={ROUTES.MAP} moreLabel={isJa ? "地図で見る" : "View on map"} />
                    <ul className={`${row} m-0`} style={{ listStyle: "none" }}>
                        {spots.map((s) => {
                            const cover = coverFor(s);
                            const name = placeParts(s.label).title;
                            return (
                                <li key={s.slug} className="flex-shrink-0">
                                    <ItemLink href={linkTo("location", s.slug)}
                                          className="relative block rounded-xl overflow-hidden bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                          style={{ width: "156px", height: "116px", touchAction: "manipulation" }}>
                                        {cover && <Thumb photo={cover} alt="" sizes="156px" />}
                                        {/* 名前は写真の上（白・下に黒 0→80% のぼかし）。写真の上なので真鍮は置かない */}
                                        <span className="absolute inset-x-0 bottom-0 px-3 pt-8 pb-2.5 font-serif font-bold text-white truncate"
                                              title={s.label}
                                              style={{ fontSize: "18px", lineHeight: "24px", background: "linear-gradient(to bottom, rgb(0 0 0 / 0), rgb(0 0 0 / 0.8))" }}>
                                            {name}
                                        </span>
                                    </ItemLink>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {featured && (
                <section aria-labelledby="discover-picks">
                    <SectionHead id="discover-picks" eyebrow={`PICKS · ${featured.label}`} title={isJa ? "おすすめ" : "Picks"}
                                 href={linkTo("category", featured.slug)} moreLabel={more} />
                    <ul className={`${row} m-0`} style={{ listStyle: "none" }} data-testid="discover-picks">
                        {featured.photos.map((p) => (
                            <li key={p.id} className="flex-shrink-0">
                                <ItemLink href={ROUTES.PHOTO(p.id)}
                                      className="relative block rounded-lg overflow-hidden bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      style={{ width: "120px", height: "160px", touchAction: "manipulation" }}>
                                    <Thumb photo={p} alt={photoAltText(p, isJa ? "ja" : "en")} sizes="120px" cellAspect={3 / 4} />
                                </ItemLink>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {colors.length > 0 && (
                <section aria-labelledby="discover-colors">
                    <SharedSectionHead id="discover-colors" eyebrow="COLORS" title={isJa ? "色から探す" : "Browse by color"} testId="discover-section-head" />
                    {/* 5 等分の位置に左から詰める（色が 3 つでも丸が左右に離れて浮かない・iOS #419 ③） */}
                    <ul className="grid grid-cols-5 lg:flex lg:gap-6 gap-y-3 m-0 p-0 -mx-2 lg:mx-0" style={{ listStyle: "none" }} data-testid="discover-colors">
                        {colors.map((c) => {
                            const key = `color:${c.family}`;
                            const on = open === key;
                            const t = COLOR_TEXT[c.family];
                            return (
                                <li key={c.family} className="flex justify-center lg:block">
                                    <button type="button" onClick={() => setOpen(on ? null : key)} aria-pressed={on}
                                            aria-label={isJa ? `${t.label.ja}（${t.note.ja}）・${c.count}枚` : `${t.label.en} (${t.note.en}), ${c.count} photos`}
                                            className="flex flex-col items-center gap-1.5 w-[68px] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
                                            style={{ touchAction: "manipulation" }}>
                                        <span className={`relative block rounded-full overflow-hidden bg-surface ${on ? "ring-[2.5px] ring-white" : "ring-1 ring-line"}`}
                                              style={{ width: "62px", height: "62px" }}>
                                            <Thumb photo={c.photos[0]} alt="" sizes="62px" cellAspect={1} />
                                        </span>
                                        <span aria-hidden="true" className={`text-center leading-4 line-clamp-2 ${on ? "text-white" : "text-text-2"}`} style={{ fontSize: "12px" }}>
                                            {isJa ? t.note.ja : t.note.en}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {gear.length > 0 && (
                <section aria-labelledby="discover-gear">
                    {/* 機種名で探す（`/camera/*`）は索引へ（Web だけ・内部リンク） */}
                    <SectionHead id="discover-gear" eyebrow="GEAR" title={isJa ? "機材から探す" : "Browse by gear"}
                                 href={collectionIndexPath("camera")} moreLabel={isJa ? "機種で見る" : "By camera"} />
                    <ul className="grid grid-cols-3 gap-2 m-0 p-0" style={{ listStyle: "none" }} data-testid="discover-gear">
                        {gear.map((g) => {
                            const key = `gear:${g.group}`;
                            const on = open === key;
                            const t = GEAR_TEXT[g.group];
                            return (
                                <li key={g.group} className="flex">
                                    <button type="button" onClick={() => setOpen(on ? null : key)} aria-pressed={on}
                                            aria-label={isJa ? `${t.label.ja} ${t.range.ja}` : `${t.label.en} ${t.range.en}`}
                                            className={`w-full min-h-[88px] flex flex-col items-start gap-1.5 rounded-xl px-3 py-2.5 text-left transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent ${on ? "bg-surface-2 ring-[1.5px] ring-inset ring-white" : "bg-surface ring-1 ring-inset ring-line hover:bg-surface-2"}`}
                                            style={{ touchAction: "manipulation" }}>
                                        <CameraIcon aria-hidden="true" className="text-text-2" style={{ width: 22, height: 22, strokeWidth: 1.4 }} />
                                        <span aria-hidden="true" className="flex flex-col gap-0.5">
                                            <span className="text-white line-clamp-2" style={{ fontSize: "15px", lineHeight: "20px" }}>{isJa ? t.label.ja : t.label.en}</span>
                                            <span className="text-text-3 tabular-nums" style={{ fontSize: "12px", lineHeight: "16px" }}>{isJa ? t.range.ja : t.range.en}</span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {openShelf && openShelf.length > 0 && (
                <div data-testid="discover-open-shelf">
                    <GalleryGrid photos={openShelf} locale={isJa ? "ja" : "en"} categoryDisplayMap={categoryDisplayMap}
                                 onOpenPhoto={onOpenPhoto} sizes={GRID_SIZES_SEARCH} columnsClassName={GRID_COLUMNS_SEARCH} searchTiles />
                </div>
            )}
        </div>
    );
}
