"use client";

import React from "react";
import Link from "next/link";
import type { Photo, Locale } from "@/lib/data/photos";
import { ROUTES } from "@/lib/routes";
import { getLocalized } from "@/lib/data/photos";
import { displayTitle } from "@/lib/utils/photoTitle";
import { sortByNewest } from "@/lib/utils/photoOrder";
import Thumb from "./Thumb";

/**
 * ホームのいちばん上に置く**特集の1枚**。
 *
 * ## 出す条件（ここがこの部品の本体）
 *
 * **運営が選んだ写真（`featured === true`）が、公開のまま1枚以上あるときだけ。**
 * owner の指示:「掲載可能な実写真がない場合は特集領域そのものを表示しない」。
 * だから**枠だけ出して「準備中」と書く形にはしない**——空の枠はページの
 * いちばん強い場所を食うだけで、誰の役にも立たない。
 *
 * ⚠️ **実データでは今 0 枚**（`app/data/photos.json` の公開30枚に
 * `featured` は1つも無い）。つまり**本番では今この帯は出ない**。
 * 出す人は管理画面で写真に「おすすめ」の印を付ける——**新しい仕組みも
 * ダミーのAPIも作っていない**（`FeaturedSections` が既に使っている
 * 同じ印を読むだけ）。
 *
 * ## 選び方
 *
 * **新しい順の1枚**（`sortByNewest`＝サイト共通の並び）。「人気」では選ばない
 * ——実データは いいね0・コメント0 で、人気の根拠がどこにも無い
 * （架空の順位を出さない、という指示そのもの）。
 *
 * ## 画像は 512w のまま
 *
 * `Thumb` が出すのは 256w / 512w の派生だけで、**特集のために大きい派生を
 * 増やしてはいない**（owner:「画像をむやみに高解像度配信へ変更しない」）。
 * そのぶん帯は**背を低く**し（スマホ 3:2／PC 12:5）、上に濃い被せを置いて
 * 文字を乗せる。本実装で特集を採るなら「特集用に 1024w を1つ足すか」は
 * 別に決めること。
 */
type Props = {
    photos: Photo[];
    locale: Locale;
};

export default function HomeHero({ photos, locale }: Props) {
    const hero = React.useMemo(() => {
        const picks = photos.filter((p) => p.featured === true && p.published !== false);
        return picks.length ? sortByNewest(picks)[0] : undefined;
    }, [photos]);

    // **無ければ帯ごと出さない**（枠も見出しも残さない）
    if (!hero) return null;

    const raw = getLocalized(hero.title, locale) || (typeof hero.title === "string" ? hero.title : "");
    const title = displayTitle(raw);
    const eyebrow = locale === "en" ? "Featured" : "特集";

    return (
        <section className="mb-6" aria-labelledby="home-hero-heading">
            <Link
                href={ROUTES.PHOTO(hero.id)}
                prefetch={false}
                className="group block relative overflow-hidden rounded-2xl ring-1 ring-line focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={{ aspectRatio: "3 / 2" }}
            >
                <div className="absolute inset-0">
                    <Thumb photo={hero} alt="" sizes="(min-width:1024px) 640px, 100vw" priority />
                </div>

                {/* 文字を読ませるための被せ。**下半分だけ**を暗くして、
                    上半分は写真のまま見せる（写真が主役） */}
                <div aria-hidden="true"
                     className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

                <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
                    <p className="m-0 mb-1.5 font-serif tracking-[0.18em] text-white/70"
                       style={{ fontSize: "11px", lineHeight: "14px" }}>
                        {eyebrow}
                    </p>
                    <h2 id="home-hero-heading"
                        className="m-0 font-serif font-bold text-white wrap-anywhere"
                        style={{ fontSize: "clamp(20px, 3.2vw, 32px)", lineHeight: "1.2" }}>
                        {title || (locale === "en" ? "A photo from the road" : "旅の1枚")}
                    </h2>
                    {hero.location && (
                        <p className="m-0 mt-1.5 text-white/75" style={{ fontSize: "13px", lineHeight: "18px" }}>
                            {hero.location}
                        </p>
                    )}
                    <span className="mt-3 inline-flex items-center gap-1 text-white/90 group-hover:text-white transition-colors"
                          style={{ fontSize: "13px", lineHeight: "18px" }}>
                        {locale === "en" ? "See this photo" : "この写真を見る"}
                        <span aria-hidden="true">›</span>
                    </span>
                </div>
            </Link>
        </section>
    );
}
