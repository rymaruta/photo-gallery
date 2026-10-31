"use client";

import React from "react";
import Link from "next/link";
import { MapPinIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { CameraIcon } from "@heroicons/react/24/solid";
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
                {/* iOS の撮影スポットの札（`PhotoMapView.officialCard`・板 MapPlace・2026-10-31 束 2 M5）:
                    写真があれば札の頭に大きく（高さ 150・角 16）→ ピンと同じ印・眉（白・札はガラス）・明朝 22 の名前・
                    13 の地域・12 の出典 → 白の主ボタンと副ボタン（高さ 44）。
                    以前は 72 の四角い写真の上に 8px の出典を重ね、名前は明朝 17、主ボタンは真鍮の塗りだった。
                    **出典は写真と必ず一緒に**（CC BY・CC BY-SA の条件）。代表写真の権利の判断はサーバー側で済んでいる
                    （`lib/data/spotLink.ts` の `toSpotLink`）ので、ここは在れば出す・無ければ枠ごと出さないだけ */}
                {spot.cover && (
                    <span className="block overflow-hidden rounded-2xl bg-surface mb-3" style={{ height: "150px" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={spot.cover.src} alt={spot.cover.alt}
                             loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    </span>
                )}
                <div className="flex items-start gap-3">
                    {/* 地図のピンと同じ印（真鍮の丸に墨のカメラ・白92%の縁）。飾りなので読み上げから外す */}
                    <span aria-hidden="true" className="flex-shrink-0 inline-flex items-center justify-center rounded-full bg-accent text-ink"
                          style={{ width: "32px", height: "32px", boxShadow: "inset 0 0 0 2px rgb(255 255 255 / 0.92)" }}>
                        <CameraIcon className="w-[14px] h-[14px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                        {/* 眉。**札はガラス（地図が透ける）なので白**——真鍮は黒地の上だけ。
                            「撮影スポット」と名乗るのは人が確かめたものだけ（`stage`）。下書きは「下書き・未確認」 */}
                        <p className="m-0 eyebrow text-white/70">
                            {spot.stage === "published"
                                ? (en ? "Photo spot" : "撮影スポット")
                                : (en ? "Draft · Unreviewed" : "下書き・未確認")}
                        </p>
                        <p className="m-0 mt-1 font-serif font-bold text-white wrap-anywhere line-clamp-2"
                           style={{ fontSize: "22px", lineHeight: "1.3" }}>
                            {spot.name}
                        </p>
                        {spot.region && (
                            <p className="m-0 mt-1 text-white/70" style={{ fontSize: "13px", lineHeight: "18px" }}>
                                {spot.region}
                            </p>
                        )}
                        {spot.cover?.credit && (
                            <p className="m-0 mt-1 text-white/60 truncate" style={{ fontSize: "12px", lineHeight: "16px" }}
                               data-testid="map-spot-credit">
                                {spot.cover.credit}
                            </p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-shrink-0 inline-flex items-center justify-center rounded-full text-white/80 hover:text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white/60"
                        style={{ width: "44px", height: "44px", marginTop: "-6px", marginRight: "-6px", touchAction: "manipulation" }}
                        aria-label={en ? "Close" : "閉じる"}
                    >
                        <span className="inline-flex items-center justify-center rounded-full bg-white/8" style={{ width: "30px", height: "30px" }}>
                            <XMarkIcon className="w-4 h-4" aria-hidden="true" />
                        </span>
                    </button>
                </div>

                <div className="flex flex-wrap items-start gap-2" style={{ marginTop: "12px" }}>
                    {/* 主ボタンは白の塗りに墨（札はガラスの地＝写真のある画面と同じ扱い・iOS の `jpPillButton(.primary)`） */}
                    <Link
                        href={`${ROUTES.SPOTS}/${spot.slug}`}
                        prefetch={false}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary text-ink font-semibold hover:brightness-110 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white"
                        style={{ fontSize: "15px", padding: "0 18px", minHeight: "44px", touchAction: "manipulation" }}
                        data-testid="map-spot-guide-link"
                    >
                        <MapPinIcon className="w-[18px] h-[18px]" aria-hidden="true" />
                        {en ? "See photo spot" : "撮影スポットを見る"}
                    </Link>
                    {/* 保存の鍵の形は `lib/utils/savedSpotKey.ts` が1か所で持つ
                        （ここで組み立てない）。`kind="spot"` を渡すだけ */}
                    <SaveSpotButton slug={spot.slug} name={spot.name} locale={locale} kind="spot" />
                </div>
            </div>
        </div>
    );
}
