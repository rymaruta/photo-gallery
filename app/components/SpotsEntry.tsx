import React from "react";
import Link from "next/link";
import HomeEntryRow from "./HomeEntryRow";
import { ROUTES } from "../../lib/routes";
import type { HomeSeasonal } from "../../lib/data/spotTopics";
import { TopicCreditLine } from "./SpotTopicLists";

/**
 * 写真の札の高さ（2026-10-11 見直し）。最初の形（見出しの行 44px＋縦長のカード 166px）は
 * ホームの写真の並びを約210px 押し下げた。見出しの行をやめ（先頭の札が兼ねる）、札を 80px にして、
 * クレジットの2行（あるときだけ）を足しても約120px に収める
 */
const CARD_H = 80;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

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
                <section className="mb-3" aria-labelledby="home-season-spots" data-testid="home-season-spots">
                    {/* 見出しの行は置かない（高さを食う）。見出しは読み上げ用に残し、見た目は並びの先頭の札が兼ねる */}
                    <h2 id="home-season-spots" className="sr-only">
                        {en ? `Photo spots for ${SEASON_LABEL[seasonal.season].en}` : `いまの季節（${SEASON_LABEL[seasonal.season].ja}）の撮影スポット`}
                    </h2>
                    <ul className="flex gap-2 overflow-x-auto m-0 p-0 pb-1 -mx-1 px-1" style={{ listStyle: "none", scrollSnapType: "x proximity" }}>
                        <li className="shrink-0 w-[112px]" style={{ scrollSnapAlign: "start" }}>
                            {/* 先頭の札＝季節の頁への入口（「すべて見る」）。黒地なので眉ラベルは真鍮 */}
                            <Link href={seasonal.href} prefetch={false} data-testid="home-season-all"
                                  className="flex flex-col justify-between w-full rounded-xl bg-surface hover:bg-surface-2 transition-colors p-2 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
                                  style={{ height: `${CARD_H}px` }}>
                                <span className="eyebrow text-accent">
                                    {en ? "This season" : "いまの季節"}
                                </span>
                                {/* 「秋の／撮影スポット」で折る（語の途中で折らない） */}
                                <span className="font-serif font-bold text-white" style={{ fontSize: "13px", lineHeight: "16px", wordBreak: "keep-all" }}>
                                    {en ? `${cap(SEASON_LABEL[seasonal.season].en)} spots` : <>{SEASON_LABEL[seasonal.season].ja}の<wbr />撮影スポット</>}
                                </span>
                                <span className="text-white/60 whitespace-nowrap" style={{ fontSize: "12px", lineHeight: "16px" }}>
                                    {en ? `All ${seasonal.total}` : `すべて ${seasonal.total}件`}<span aria-hidden="true" className="ml-0.5">›</span>
                                </span>
                            </Link>
                        </li>
                        {seasonal.spots.map((s) => (
                            <li key={s.slug} className="shrink-0 w-[120px] overflow-hidden" style={{ scrollSnapAlign: "start" }}>
                                <Link href={`/spots/${s.slug}`} prefetch={false}
                                      className="relative block w-full rounded-xl overflow-hidden bg-surface-2 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
                                      style={{ height: `${CARD_H}px` }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={s.src} alt="" loading="lazy" decoding="async"
                                         className="absolute inset-0 w-full h-full object-cover" />
                                    {/* 名前は写真の上（白・下に暗いぼかし）。写真の上に真鍮は置かない */}
                                    <span className="absolute inset-x-0 bottom-0 px-2 pt-4 pb-1.5 text-white font-semibold truncate"
                                          style={{ fontSize: "12px", lineHeight: "16px", background: "linear-gradient(to top, rgba(0,0,0,.75), rgba(0,0,0,0))" }}>
                                        {s.name}
                                    </span>
                                </Link>
                                {/* CC BY・CC BY-SA は作者とライセンスの表示が条件。ライセンスの行を先に・切らない */}
                                {s.credit && <div className="mt-1"><TopicCreditLine credit={s.credit} compact /></div>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </>
    );
}
