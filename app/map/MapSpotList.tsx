"use client";

import React from "react";
import Link from "next/link";
import { ChevronRightIcon, MapPinIcon } from "@heroicons/react/24/outline";
import type { SpotPin } from "../../lib/data/spotLink";
import { ROUTES } from "../../lib/routes";

/**
 * 地図に出ている**公式撮影スポット**の一覧。
 *
 * ## 写真の一覧（`MapPhotoList`）と同じ作法
 *
 * **行そのものをリンクにする。** あちらの docstring が理由を書いている
 * ——「押すと選ぶだけ、にすると読み上げの人が辿り着けない」。地図を
 * 操作できない人（読み上げ・キーボード）にとって、ここが**ガイドへの
 * 唯一の経路**になる。
 *
 * ## 出さないもの
 *
 * **「人気」「評価」「訪問者数」「写真の枚数」は出さない。** 台帳は
 * 数を持っていないし、並べると順位の表に見える（owner の指示 2026-09-22）。
 * 出すのは台帳が実際に持っている値（代表写真・名前・地域）だけ。
 *
 * **並べ替えない。** 渡された順（台帳の順）のまま。枚数順や近い順にすると、
 * 写真が1枚増えるたび・現在地が動くたびに並びが変わる。
 *
 * **寸法は px。** 640px 未満で root が 14px に落ちるため。
 */
export default function MapSpotList({ spots, locale }: {
    spots: readonly SpotPin[];
    locale: "ja" | "en";
}) {
    const en = locale === "en";
    if (spots.length === 0) return null;

    return (
        <section aria-labelledby="map-spot-list-heading" style={{ marginTop: "12px" }}>
            <h2
                id="map-spot-list-heading"
                className="m-0 font-serif font-bold text-white"
                style={{ fontSize: "14px", lineHeight: "20px", marginBottom: "8px" }}
            >
                {en ? "Official shooting spots" : "公式撮影スポット"}
            </h2>
            <ul className="list-none m-0 p-0" data-testid="map-spot-list">
                {spots.map((s) => (
                    <li key={s.slug} style={{ marginBottom: "8px" }}>
                        <Link
                            href={`${ROUTES.SPOTS}/${s.slug}`}
                            prefetch={false}
                            className="flex items-center rounded-2xl bg-surface-2/70 ring-1 ring-white/10 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                            style={{ gap: "12px", padding: "8px" }}
                        >
                            {/* 代表写真。**権利の判断はサーバー側で済んでいる**ので、
                                在れば出す・無ければ地図の印を置くだけ */}
                            <span
                                className="flex-shrink-0 flex items-center justify-center overflow-hidden rounded-xl bg-white/5"
                                style={{ width: "56px", height: "56px" }}
                            >
                                {s.cover ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={s.cover.src}
                                        alt=""
                                        width={56}
                                        height={56}
                                        loading="lazy"
                                        decoding="async"
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <MapPinIcon className="w-5 h-5 text-white/50" aria-hidden="true" />
                                )}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-white" style={{ fontSize: "14px", lineHeight: "20px" }}>
                                    {s.name}
                                </span>
                                <span className="block text-white/60" style={{ fontSize: "11px", lineHeight: "16px" }}>
                                    {en ? "Official guide" : "公式撮影地ガイド"}
                                    {s.region ? ` ・ ${s.region}` : ""}
                                </span>
                            </span>
                            {/* 濃さは `MapPhotoList` の同じ矢印に揃える（`/40` は
                                黒地で約3.7:1 で、見張りが落とす） */}
                            <ChevronRightIcon aria-hidden="true" className="flex-shrink-0 text-white/50" style={{ width: "18px", height: "18px" }} />
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}
