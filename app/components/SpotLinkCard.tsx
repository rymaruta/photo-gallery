"use client";

import React from "react";
import Link from "next/link";
import type { Photo } from "@/lib/data/photos";
import { SPOTS } from "@/lib/data/spots";
import { publishableSpots, usesMapHero, needsVisibleCredit } from "@/lib/utils/spotGuide";
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
 * 台帳に無い・下書き・情報が足りないスポットも出さない（`publishableSpots`）
 * ——押した先が 404 になるリンクを置かない。
 *
 * **公式スポットが未登録なら何も描かない。** 既存の撮影地ページへの導線は
 * 写真の下のチップが持っているので、ここが空でも行き先は消えない。
 */
export default function SpotLinkCard({ photo, locale }: { photo: Photo; locale: string }) {
    const isJa = locale !== "en";
    const spot = React.useMemo(() => {
        if (!photo.spotId) return undefined;
        return publishableSpots(SPOTS).find((s) => s.spotId === photo.spotId);
    }, [photo.spotId]);

    if (!spot) return null;

    const where = [spot.region?.prefecture, spot.region?.city].filter(Boolean).join(" ");
    const mapHref = spot.coords ? `${ROUTES.MAP}#14/${spot.coords.lat}/${spot.coords.lng}` : ROUTES.MAP;
    const noImage = usesMapHero(spot);

    return (
        <section className="mt-5" aria-labelledby="photo-spot-card">
            <h2 id="photo-spot-card" className="m-0 mb-2 text-white/60" style={{ fontSize: "12px", lineHeight: "16px" }}>
                {isJa ? "この写真の撮影スポット" : "Where this was taken"}
            </h2>
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
                                <img src={spot.coverImage!.src} alt={spot.coverImage!.alt}
                                     className="absolute inset-0 w-full h-full object-cover" />
                                {needsVisibleCredit(spot) && (
                                    <span className="absolute bottom-0.5 right-1 text-white/70" style={{ fontSize: "8px" }}>
                                        {spot.coverImage!.requiredCreditText || spot.coverImage!.credit}
                                    </span>
                                )}
                            </>
                        )}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block font-serif font-bold text-white wrap-anywhere"
                              style={{ fontSize: "16px", lineHeight: "22px" }}>{spot.name}</span>
                        {where && (
                            <span className="block mt-0.5 text-white/60" style={{ fontSize: "12px", lineHeight: "16px" }}>{where}</span>
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
