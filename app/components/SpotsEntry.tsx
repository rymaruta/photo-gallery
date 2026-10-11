import React from "react";
import Link from "next/link";
import HomeEntryRow from "./HomeEntryRow";
import { ROUTES } from "../../lib/routes";
import type { HomeSeasonal } from "../../lib/data/spotTopics";

const SEASON_LABEL = {
    spring: { ja: "春", en: "spring" },
    summer: { ja: "夏", en: "summer" },
    autumn: { ja: "秋", en: "autumn" },
    winter: { ja: "冬", en: "winter" },
} as const;

/**
 * ホームから撮影スポットのガイド（`/spots`）への入口。1行（形は `HomeEntryRow`）＋
 * **いまの季節の撮影スポット**（写真つき・横に流す・2026-10-11）。
 *
 * それまでトップから `/spots` へ行く道はフッターの1本しか無かった。
 * 今日の一問の行のすぐ下（どのタブでも同じ位置）に置く。
 *
 * 2026-10-11 判断（owner の「検索で見つけてもらう」）: 1行だけだった入口に、季節に合うスポットを
 * 写真つきで数件並べる。`HomeEntryRow` の「写真の並びより前に大きな札を足さない」に合わせ、
 * **高さを抑えた横一列**（縦に積まない）にした。
 *
 * 🔴 **台帳（`SPOTS`）をここで読まない。** この部品はクライアント側で描かれるので、
 * 読めば数千件の JSON がトップの JS に乗る。並べる数件は**ビルド時にサーバーが選んで**
 * （`homeSeasonalSpots`・`app/page.tsx`）名前・場所・写真の場所だけを props で渡す。
 */
export default function SpotsEntry({ locale, seasonal = null }: { locale: "ja" | "en"; seasonal?: HomeSeasonal | null }) {
    const en = locale === "en";
    return (
        <>
            <HomeEntryRow
                href={ROUTES.SPOTS}
                testId="home-spots-entry"
                eyebrow={en ? "Photo spots" : "撮影スポット"}
                text={en ? "Guides to places worth shooting" : "撮りに行ける場所のガイド"}
            />
            {seasonal && seasonal.spots.length > 0 && (
                <section className="mb-4" aria-labelledby="home-season-spots" data-testid="home-season-spots">
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                        <h2 id="home-season-spots" className="m-0 font-serif font-bold text-white" style={{ fontSize: "16px", lineHeight: "22px" }}>
                            {en ? `Photo spots for ${SEASON_LABEL[seasonal.season].en}` : `いまの季節（${SEASON_LABEL[seasonal.season].ja}）の撮影スポット`}
                        </h2>
                        <Link href={seasonal.href} prefetch={false}
                              className="shrink-0 inline-flex items-center min-h-[44px] text-white/60 hover:text-white transition-colors"
                              style={{ fontSize: "12px" }}>
                            {en ? `All ${seasonal.total}` : `すべて見る（${seasonal.total}件）`}
                            <span aria-hidden="true" className="ml-1">›</span>
                        </Link>
                    </div>
                    <ul className="flex gap-2.5 overflow-x-auto m-0 p-0 pb-1 -mx-1 px-1" style={{ listStyle: "none", scrollSnapType: "x proximity" }}>
                        {seasonal.spots.map((s) => (
                            <li key={s.slug} className="shrink-0 w-[150px]" style={{ scrollSnapAlign: "start" }}>
                                <Link href={`/spots/${s.slug}`} prefetch={false}
                                      className="block rounded-xl overflow-hidden bg-surface hover:bg-surface-2 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent">
                                    <div className="relative w-full aspect-[3/2] overflow-hidden bg-surface-2">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={s.src} alt={s.alt} loading="lazy" decoding="async"
                                             className="absolute inset-0 w-full h-full object-cover" />
                                    </div>
                                    <div className="px-2.5 py-2">
                                        <p className="m-0 text-white truncate" style={{ fontSize: "13px", lineHeight: "18px" }}>{s.name}</p>
                                        {s.region && <p className="m-0 text-white/60 truncate" style={{ fontSize: "12px", lineHeight: "16px" }}>{s.region}</p>}
                                        {/* CC BY・CC BY-SA は作者とライセンスの表示が条件 */}
                                        {s.credit && (
                                            <p className="m-0 text-white/60 truncate" style={{ fontSize: "12px", lineHeight: "16px" }} title={s.credit}>
                                                {en ? `Photo: ${s.credit}` : `写真: ${s.credit}`}
                                            </p>
                                        )}
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </>
    );
}
