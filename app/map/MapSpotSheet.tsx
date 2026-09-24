"use client";

import React from "react";
import Link from "next/link";
import { MapPinIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { SpotPin } from "../../lib/data/spotLink";
import { ROUTES } from "../../lib/routes";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import SaveSpotButton from "../components/SaveSpotButton";

/**
 * 地図で**公式スポットのピン**を押したときに出るシート。
 *
 * ## 写真のシートと分けた理由
 *
 * `MapPhotoSheet` は写真の中身（サムネ・撮影日・説明・同じ場所の別の写真）を
 * 出す部品で、公式スポットには**そのどれも無い**（投稿が0枚でも成立するのが
 * あちらの肝）。1つの部品に両方を詰めると、片方では必ず半分が `null` になり、
 * 「どちらの形でも正しい」ことを確かめる先が増える。
 *
 * **外枠は同じ**（`map-sheet`）——位置・PC での板への戻り方・下のバーの
 * 避け方は `app/globals.css` の1か所が持つので、2つ目の規則を作らない。
 *
 * ## 置くもの
 *
 *   - **代表写真**（権利が確認できているときだけ）と名前・地域
 *   - **撮影ガイドを見る**（`/spots/<slug>`）… 地図 → ガイドの導線
 *   - **行きたい**（`SaveSpotButton`）… 地図 → 行きたい場所の導線
 *
 * 代表写真を置くのは owner の「**写真が主役**」から。無いスポットは
 * 枠ごと出さない——**無関係な写真で埋めない**（指示書 第5章）し、
 * 空の灰色の四角を並べても情報が増えない。
 *
 * owner のコアの鎖（さがす → 撮影地ガイド → マップ → 行きたい場所 →
 * 旅行プラン → 写真SNS）で、地図から次の2つへ繋ぐのがこのシートの役目。
 *
 * **「人気」「評価」「訪問者数」は出さない**——数えていないものを出さない
 * （owner の指示 2026-09-22）。
 */
export default function MapSpotSheet({
    spot, onClose, locale,
}: {
    spot: SpotPin;
    onClose: () => void;
    locale: "ja" | "en";
}) {
    const en = locale === "en";
    useEscapeKey(true, onClose);

    return (
        <div
            className="map-sheet fixed left-0 right-0 z-[45] px-2 pointer-events-none lg:px-0"
            style={{ bottom: "calc(12px + var(--bottom-bar-h, env(safe-area-inset-bottom, 0px)))" }}
            data-testid="map-spot-sheet"
        >
            <div
                className="pointer-events-auto mx-auto rounded-2xl bg-surface-2/95 backdrop-blur-md ring-1 ring-white/15 shadow-2xl shadow-black/50 lg:shadow-none"
                style={{ maxWidth: "560px", padding: "12px 12px 14px" }}
            >
                <div className="flex items-start gap-2">
                    {/* 代表写真。**権利の判断はサーバー側で済んでいる**
                        （`lib/data/spotLink.ts` の `toSpotLink`）ので、
                        ここは在れば出す・無ければ枠ごと出さないだけ */}
                    {spot.cover && (
                        <span className="flex-shrink-0 block overflow-hidden rounded-xl bg-white/5 relative"
                              style={{ width: "72px", height: "72px" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={spot.cover.src} alt={spot.cover.alt} width={72} height={72}
                                 loading="lazy" decoding="async" className="w-full h-full object-cover" />
                            {spot.cover.credit && (
                                <span className="absolute bottom-0 right-0 bg-black/60 text-white/85"
                                      style={{ fontSize: "8px", lineHeight: "12px", padding: "0 3px" }}
                                      data-testid="map-spot-credit">
                                    {spot.cover.credit}
                                </span>
                            )}
                        </span>
                    )}
                    <div className="min-w-0 flex-1">
                        <p className="m-0 flex items-center gap-1.5 text-white/60" style={{ fontSize: "11px", lineHeight: "16px" }}>
                            <MapPinIcon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                            {/* **「公式」と名乗るのは、運営が台帳に書いたものだけ**
                                （`publishableSpots` を通ったもの）。利用者の投稿から
                                作った撮影地ページと見分けが付くようにする */}
                            {en ? "Official spot" : "公式撮影スポット"}
                        </p>
                        <p className="m-0 mt-1 font-serif font-bold text-white wrap-anywhere"
                           style={{ fontSize: "17px", lineHeight: "23px" }}>
                            {spot.name}
                        </p>
                        {spot.region && (
                            <p className="m-0 mt-0.5 text-white/60" style={{ fontSize: "12px", lineHeight: "17px" }}>
                                {spot.region}
                            </p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-shrink-0 rounded-full text-white/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                        style={{ minWidth: "32px", minHeight: "32px", touchAction: "manipulation" }}
                        aria-label={en ? "Close" : "閉じる"}
                    >
                        <XMarkIcon className="w-5 h-5 mx-auto" aria-hidden="true" />
                    </button>
                </div>

                <div className="flex flex-wrap items-start gap-2" style={{ marginTop: "12px" }}>
                    <Link
                        href={`${ROUTES.SPOTS}/${spot.slug}`}
                        prefetch={false}
                        className="inline-flex items-center rounded-full bg-accent-fill text-white font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        style={{ fontSize: "14px", padding: "10px 18px", minHeight: "44px", touchAction: "manipulation" }}
                        data-testid="map-spot-guide-link"
                    >
                        {en ? "See the guide" : "撮影ガイドを見る"}
                    </Link>
                    {/* 保存の鍵の形は `lib/utils/savedSpotKey.ts` が1か所で持つ
                        （ここで組み立てない）。`kind="spot"` を渡すだけ */}
                    <SaveSpotButton slug={spot.slug} name={spot.name} locale={locale} kind="spot" />
                </div>
            </div>
        </div>
    );
}
