"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { usePhotos } from "../../lib/hooks/usePhotos";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import PhotoMap, { photosWithCoords } from "../components/PhotoMap";

/**
 * 撮影地マップ（/map）。位置情報を持つ公開写真を地図に載せる。
 *
 * 座標は約1km精度（アップロード側の `sanitizeCoords`）か、地名から引いた
 * おおよその位置（`geoApprox`）。どちらも「街」までしか分からない粒度で、
 * 地名（テキスト）として既に公開している以上の情報は出ない。
 */
export default function MapPage() {
    const { locale } = useLocale();
    const { photos } = usePhotos();
    const en = locale === "en";

    const geo = useMemo(() => photosWithCoords(photos.filter((p) => p.published !== false)), [photos]);
    const approxCount = useMemo(() => geo.filter((p) => p.geoApprox).length, [geo]);

    return (
        <main className="max-w-6xl mx-auto px-4 py-6 pb-28">
            <div className="flex items-baseline justify-between gap-3 mb-4">
                <h1 className="text-xl font-semibold">{en ? "Map" : "撮影地マップ"}</h1>
                <p className="text-sm text-white/50 tabular-nums">
                    {en
                        ? `${geo.length} photo${geo.length === 1 ? "" : "s"} with location`
                        : `位置情報のある写真 ${geo.length}枚`}
                </p>
            </div>

            {geo.length === 0 ? (
                // **0枚は「まだ」と言う。** 位置情報は GPS 付きの写真を上げたとき、
                // または撮影地名から補ったときに付く。無い状態を「地図が壊れた」と
                // 読ませない
                <div className="rounded-2xl ring-1 ring-white/10 bg-white/5 px-6 py-16 text-center text-white/60 text-sm">
                    <p>{en ? "No photos with location yet." : "位置情報のある写真はまだありません。"}</p>
                    <p className="mt-2 text-white/40">
                        {en
                            ? "Photos uploaded with GPS data appear here (rounded to about 1 km)."
                            : "GPS 付きの写真をアップロードすると、約1km の粒度でここに載ります。"}
                    </p>
                    <Link href={ROUTES.HOME} className="inline-block mt-6 text-sky-300 hover:text-sky-200 underline underline-offset-4">
                        {en ? "Back to gallery" : "ギャラリーへ戻る"}
                    </Link>
                </div>
            ) : (
                <>
                    <PhotoMap photos={geo} locale={locale} />
                    <p className="mt-3 text-xs text-white/40">
                        {en
                            ? "Pins are rounded to about 1 km. "
                            : "ピンの位置は約1km の粒度に丸めています。"}
                        {approxCount > 0 && (en
                            ? `${approxCount} pin${approxCount === 1 ? "" : "s"} are approximate (from place names).`
                            : `${approxCount}枚は地名から引いたおおよその位置です。`)}
                    </p>
                    {/* 地図を操作できない環境（読み上げ・キーボード）向けの一覧。
                        地図と同じ写真へ辿れる */}
                    <ul className="sr-only" aria-label={en ? "Photos on the map" : "地図上の写真"}>
                        {geo.map((p) => (
                            <li key={p.id}>
                                <Link href={ROUTES.PHOTO(p.id)}>{p.location || p.id}</Link>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </main>
    );
}
