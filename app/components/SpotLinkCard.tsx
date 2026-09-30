"use client";

import React from "react";
import Link from "next/link";
import type { SpotLink } from "@/lib/data/spotLink";
import { ROUTES } from "@/lib/routes";

/**
 * 写真詳細に出す**公式撮影地ガイドへのカード**。
 *
 * 🔴 **出す条件は1つだけ: 写真が `spotId` を持っていること。**
 *
 * owner の指示書 第11章:「写真の `location` 文字列が似ているだけで、未確認の
 * スポットへ紐付けないでください」「撮影位置と被写体の位置を混同しないで
 * ください」。**だから文字列では一切照合しない**——`spotId` は人が確認した
 * ものしか入らない（`lib/utils/spots.ts` の `linkStates` が候補で止める）。
 *
 * 台帳に無い・下書き・情報が足りないスポットも出さない——押した先が 404 に
 * なるリンクを置かない。**その判断はサーバー側**（`lib/data/spotLink.ts` の
 * `spotLinkForPhoto`）で済ませてある。
 *
 * **公式スポットが未登録なら何も描かない。** 既存の撮影地ページへの導線は
 * 写真の下のチップが持っているので、ここが空でも行き先は消えない。
 *
 * ## 🔴 台帳をここから読んではいけない
 *
 * 以前このファイルは `SPOTS` を直接 import していた。`"use client"` なので
 * **`content/spots.json` の全文が写真ページ30枚のチャンクに載っていた**
 * （台帳に1件入れてビルドして実測）。写真ページは検索の着地点で、
 * CLAUDE.md の優先度（表示速度）に直接当たる。
 * **受け取るのは解いたあとの `SpotLink` だけ。**
 * 見張りは `app/__tests__/spotLedgerClientImport.test.ts`。
 */
export default function SpotLinkCard({ spot, locale, heading, headingId = "photo-spot-card" }: {
    spot: SpotLink | null;
    locale: string;
    /** 見出しの文言（既定は写真詳細の「この写真の撮影スポット」）。撮影地のページは別の言い方。
     *  `null` なら見出しを出さない（同じ見出しのカードを続けて並べるとき、2枚目以降） */
    heading?: string | null;
    /** 見出しの id（1画面に複数置くとき重ならないように） */
    headingId?: string;
}) {
    const isJa = locale !== "en";

    if (!spot) return null;

    const where = spot.region;
    const mapHref = spot.coords ? `${ROUTES.MAP}#14/${spot.coords.lat}/${spot.coords.lng}` : ROUTES.MAP;
    const noImage = !spot.cover;

    return (
        <section className={heading === null ? "mt-2" : "mt-5"} aria-labelledby={heading === null ? undefined : headingId}
                 aria-label={heading === null ? spot.name : undefined}>
            {heading !== null && (
                <h2 id={headingId} className="m-0 mb-2 text-white/60" style={{ fontSize: "12px", lineHeight: "16px" }}>
                    {heading ?? (isJa ? "この写真の撮影スポット" : "Where this was taken")}
                </h2>
            )}
            <div className="rounded-2xl overflow-hidden bg-surface ring-1 ring-line">
                <Link href={`/spots/${spot.slug}`} prefetch={false}
                      className="flex gap-3 p-3 hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <span className="relative flex-shrink-0 rounded-xl overflow-hidden bg-surface-2"
                          style={{ width: "88px", height: "88px" }}>
                        {noImage ? (
                            <span className="absolute inset-0 flex items-center justify-center text-white/50"
                                  style={{ fontSize: "11px" }}>{isJa ? "写真なし" : "No photo"}</span>
                        ) : (
                            <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={spot.cover!.src} alt={spot.cover!.alt}
                                     className="absolute inset-0 w-full h-full object-cover" />
                                {spot.cover!.credit && (
                                    <span className="absolute bottom-0.5 right-1 text-white/70" style={{ fontSize: "8px" }}>
                                        {spot.cover!.credit}
                                    </span>
                                )}
                            </>
                        )}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block font-serif font-bold text-white wrap-anywhere"
                              style={{ fontSize: "16px", lineHeight: "22px" }}>{spot.name}</span>
                        {(where || spot.stage === "review") && (
                            <span className="block mt-0.5 text-white/60" style={{ fontSize: "12px", lineHeight: "16px" }}>
                                {/* 運営未確認の下書きはそう名乗る（「公式」の語はここに無いが、印も無いと確認済みに見える） */}
                                {spot.stage === "review" && (isJa ? "下書き" : "Draft")}
                                {spot.stage === "review" && where ? " ・ " : ""}
                                {where}
                            </span>
                        )}
                        {spot.summary && (
                            <span className="block mt-1 text-white/75 line-clamp-2"
                                  style={{ fontSize: "12px", lineHeight: "18px" }}>{spot.summary}</span>
                        )}
                        <span className="block mt-1.5 text-white/85" style={{ fontSize: "12px" }}>
                            {isJa ? "撮影ガイドを見る" : "See the guide"} <span aria-hidden="true">›</span>
                        </span>
                    </span>
                </Link>
                {spot.coords && (
                    <Link href={mapHref} prefetch={false}
                          className="block px-3 py-2.5 border-t border-white/10 text-white/70 hover:text-white hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          style={{ fontSize: "12px" }}>
                        {isJa ? "地図で見る" : "View on map"} <span aria-hidden="true">›</span>
                    </Link>
                )}
            </div>
        </section>
    );
}
