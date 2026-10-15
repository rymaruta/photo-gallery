"use client";

import React from "react";
import Link from "next/link";
import { ArrowTurnUpRightIcon, SunIcon, CameraIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import SaveSpotButton, { TILE, TILE_OFF, TILE_TEXT, TILE_ICON } from "../../components/SaveSpotButton";
import type { SpotLink } from "@/lib/data/spotLink";
import {
    nextGoldenHour, goldenLineParts, directionsUrl, inspiredUploadHref, type NextGolden,
} from "@/lib/utils/photoTrip";

/**
 * 写真の詳細の「**NEXT TRIP · 次の旅へ**」の段（板 `PhotoDetail.dc.html`・アプリの `PhotoTripSection`）。
 *
 * 写真を見た人が、そこから 行きたい → 経路 → いつ（次のゴールデンアワー）→ 撮りに行く、へ進めるようにする。
 * 判断は全部 `lib/utils/photoTrip.ts`（値で試せる形）。ここは並べるだけ。
 *
 * ## 出すもの（**持っているものだけ**。何も無ければ段ごと出さない）
 *
 *  - **行きたい** … 写真が台帳のスポット（`spotLink`）を指すときだけ。既存の「行きたい場所」
 *    （`SaveSpotButton`・`spots#<uid>`）にそのまま入る。撮影スポットのページと同じ鍵なので、
 *    どこで押しても状態がそろう
 *  - **経路** … Google マップの経路（外へ出るリンク）。**黒地の上の外へ出るリンクなので真鍮**
 *    （owner の好み: スポットの「公式サイト」と同じ扱い）
 *  - **次のゴールデンアワー** … 時計（`zone`）が分かるときだけ。**描くのは水和の後**——
 *    「今」は静的HTMLを建てた時刻ではないので、HTMLには焼かない（建てた日の時刻が残る）
 *  - **この写真を見て撮りに行く** … 投稿画面へ（`/user/upload?inspiredBy=<id>`）。
 *    受け側（投稿画面が読む）は別の担当
 *
 * 見た目: 写真の下の黒地の段なので、印（旗・経路・太陽・カメラ）は真鍮、字は白。眉ラベルは
 * 真鍮 11px（本文の最小 12px の例外は眉ラベルだけ）。押せるものは 48px（タイル）・44px（行）。
 */
export default function PhotoTripSection({
    spot, directionsTo, zone, inspiredPhotoId, locale,
}: {
    /** 写真が指す台帳のスポット（サーバーで解いたもの）。無ければ「行きたい」を出さない */
    spot: SpotLink | null;
    /** 経路の行き先（`directionsTarget`）。無ければ経路を出さない */
    directionsTo: { lat: number; lng: number } | null;
    /** 光の時刻を言う時計（`photoLightZone`）。無ければ「いつ」を出さない */
    zone: string | null;
    /** 「この写真を見て撮りに行く」の元の写真。出さないなら null */
    inspiredPhotoId: string | null;
    locale: string;
}) {
    const isJa = locale !== "en";
    const [golden, setGolden] = React.useState<NextGolden | null>(null);
    React.useEffect(() => {
        setGolden(directionsTo && zone ? nextGoldenHour(directionsTo, zone, new Date()) : null);
    }, [directionsTo, zone]);

    const routeHref = directionsUrl(directionsTo);
    const tiles = (spot ? 1 : 0) + (routeHref ? 1 : 0);
    // 「いつ」は時計が分かるときにだけ出る行。描く前（水和前）でも段を出すかどうかは変えない
    // ——出してから段が増えると下がずれる。時計が分かる写真は、経路の行き先も持っている
    if (tiles === 0 && !inspiredPhotoId) return null;

    const line = golden ? goldenLineParts(golden, isJa) : null;
    const routeName = spot?.name;

    return (
        <section aria-label={isJa ? "写真から、次の旅へ" : "From this photo to your next trip"}
                 className="flex flex-col gap-2.5 pt-2" data-testid="photo-trip">
            {/* 眉ラベル＋消える線（板の `.eb.ebl`） */}
            <p className="m-0 flex items-center gap-2.5 text-accent font-semibold" aria-hidden="true"
               style={{ fontSize: "11px", lineHeight: "14px", letterSpacing: "0.14em" }}>
                <span className="flex-shrink-0">{isJa ? "NEXT TRIP · 次の旅へ" : "NEXT TRIP"}</span>
                <span className="flex-1 h-px" style={{ background: "linear-gradient(90deg, rgba(201,166,107,.55), rgba(201,166,107,0))" }} />
            </p>

            {tiles > 0 && (
                // **格子で等分**（`flex-1` だと包んだ側だけ狭くなる・`SaveSpotButton` の注記）
                <div className={`grid gap-2 ${tiles === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                    {spot && (
                        <SaveSpotButton slug={spot.slug} name={spot.name} locale={isJa ? "ja" : "en"} kind="spot" variant="tile" />
                    )}
                    {routeHref && (
                        <a href={routeHref} target="_blank" rel="noopener noreferrer"
                           // **字も印も真鍮**（外へ出るリンク）。`TILE_OFF` は字が白なので使わない
                           // （同じ性質の utility を2つ並べると、どちらが勝つかが候補名の順で決まる）
                           className={`${TILE} bg-surface hover:bg-surface-2 text-accent min-w-0`}
                           aria-label={routeName
                               ? (isJa ? `${routeName}への経路（Google マップ）` : `Directions to ${routeName} (Google Maps)`)
                               : (isJa ? "撮影地への経路（Google マップ）" : "Directions to where this was taken (Google Maps)")}
                           data-testid="photo-trip-directions"
                           style={{ minHeight: 48, touchAction: "manipulation" }}>
                            <ArrowTurnUpRightIcon className={TILE_ICON} aria-hidden />
                            <span className={TILE_TEXT}>{isJa ? "経路" : "Directions"}</span>
                        </a>
                    )}
                </div>
            )}

            {line && (
                <p className="m-0 flex items-center gap-2 text-white/70" data-testid="photo-trip-golden"
                   style={{ fontSize: "13px", lineHeight: "18px" }}>
                    <SunIcon className="w-4 h-4 flex-shrink-0 text-accent" aria-hidden />
                    <span>{line.label}</span>
                    <span className="tabular-nums text-white font-semibold">{line.time}</span>
                </p>
            )}

            {inspiredPhotoId && (
                <Link href={inspiredUploadHref(inspiredPhotoId)} prefetch={false}
                      className={`${TILE} ${TILE_OFF} w-full`}
                      data-testid="photo-trip-inspired"
                      style={{ minHeight: 48, touchAction: "manipulation" }}>
                    <CameraIcon className={`${TILE_ICON} text-accent`} aria-hidden />
                    <span className={TILE_TEXT}>{isJa ? "この写真を見て撮りに行く" : "Go shoot it yourself"}</span>
                    <ChevronRightIcon className="w-4 h-4 flex-shrink-0 text-white/50" aria-hidden />
                </Link>
            )}
        </section>
    );
}
