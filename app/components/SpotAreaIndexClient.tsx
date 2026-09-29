"use client";

import React from "react";
import Link from "next/link";
import type { SpotArea } from "@/lib/data/spotLink";
import { REGIONS, REGION_EN, type RegionName } from "@/lib/data/prefectures";
import { useLocale } from "@/app/i18n/context";
import { ROUTES } from "@/lib/routes";
import { CHIP_OFF } from "./chipStyles";

/**
 * **公式撮影地ガイドの入口**（`/spots`）。**都道府県の一覧**を出す。
 *
 * 🔴 ここにスポットそのものを並べない。台帳が伸びるとページが重くなり、
 * HTML は `no-cache, no-store` で配るので**訪問のたびに**落ちる
 * （実測は `lib/data/spotLink.ts` の `SpotArea` の注記）。
 *
 * 受け取るのは**県の名前と件数だけ**——47県でも3KBに満たない。
 */
type Props = {
    areas: SpotArea[];
    /** ページを建てているスポットの数（下書きを建てる設定なら下書きを含む） */
    total: number;
    /** うち運営未確認の下書き。`total` と同じなら全部が下書き */
    draftCount: number;
};

export default function SpotAreaIndexClient({ areas, total, draftCount }: Props) {
    const { locale } = useLocale();
    const isJa = locale !== "en";

    /** 地方ごとにまとめる。**0件の地方は作らない** */
    const groups = React.useMemo(() => {
        const out: Array<{ region: RegionName | null; items: SpotArea[] }> = [];
        for (const r of REGIONS) {
            const items = areas.filter((a) => a.region === r);
            if (items.length > 0) out.push({ region: r, items });
        }
        const overseas = areas.filter((a) => a.region === null);
        if (overseas.length > 0) out.push({ region: null, items: overseas });
        return out;
    }, [areas]);

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg mx-auto w-full max-w-5xl lg:max-w-6xl">
            <h1 className="font-serif text-2xl sm:text-[34px] sm:leading-[1.15] font-bold m-0 tracking-tight">
                {isJa ? "撮影スポットをさがす" : "Find a place to shoot"}
            </h1>
            {/* 0件のときは下の「まだありません」だけを出す（「0件の下書きです」と並べない） */}
            {total > 0 && (
            <p className="m-0 mt-2 mb-6 text-white/70" style={{ fontSize: "14px", lineHeight: "22px" }}>
                {/* **「運営が調べた」と言えるのは、人が確かめた行だけ。** 全部が下書きなら
                    そう言う（2026-09-24 の台帳は 1,417件が未確認のまま「調べた」と名乗っていた） */}
                {draftCount >= total
                    ? (isJa
                        ? `撮影地ガイドの下書きです（${total}件・運営未確認）。地域を選ぶと、その中のスポットが出ます。`
                        : `Draft guides, not checked by us yet (${total}). Pick an area to see the spots in it.`)
                    : (isJa
                        ? `運営が調べた撮影地のガイドです（${total}件${draftCount > 0 ? `・うち下書き${draftCount}件` : ""}）。地域を選ぶと、その中のスポットが出ます。`
                        : `Guides we researched (${total}${draftCount > 0 ? `, ${draftCount} drafts` : ""}). Pick an area to see the spots in it.`)}
            </p>
            )}

            {groups.length === 0 ? (
                /* **架空の県で埋めない。** 0件なら0件と言う */
                <p className="m-0 text-white/70" style={{ fontSize: "14px" }}>
                    {isJa ? "公開中の撮影スポットはまだありません。" : "No published spots yet."}
                </p>
            ) : (
                groups.map(({ region, items }) => (
                    <section key={region ?? "overseas"} className="mb-7">
                        <h2 className="font-serif font-bold m-0 mb-2.5 text-white/90"
                            style={{ fontSize: "17px", lineHeight: "24px" }}>
                            {region === null
                                ? (isJa ? "海外" : "Outside Japan")
                                : (isJa ? region : REGION_EN[region])}
                        </h2>
                        <ul className="flex flex-wrap gap-1.5 m-0 p-0" style={{ listStyle: "none" }}>
                            {items.map((a) => (
                                <li key={a.slug}>
                                    <Link href={ROUTES.SPOT_AREA(a.slug)} prefetch={false}
                                          className={`inline-flex items-center gap-1.5 rounded-full ${CHIP_OFF} transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
                                          style={{ fontSize: "13px", lineHeight: "18px", padding: "7px 14px", minHeight: "34px" }}>
                                        {isJa ? a.name : a.nameEn}
                                        <span className="text-white/60" style={{ fontSize: "11px" }}>{a.count}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))
            )}
        </main>
    );
}
