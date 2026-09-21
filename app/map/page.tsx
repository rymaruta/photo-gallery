"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePhotos } from "../../lib/hooks/usePhotos";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import PhotoMap, { photosWithCoords, type MapSelection } from "../components/PhotoMap";
import MapPhotoSheet from "./MapPhotoSheet";
import { getLocalized } from "../../lib/data/photos";

/**
 * 撮影地マップ（/map）。位置情報を持つ公開写真を地図に載せる。
 *
 * 座標は約1km精度（アップロード側の `sanitizeCoords`）か、地名から引いた
 * おおよその位置（`geoApprox`）。どちらも「街」までしか分からない粒度で、
 * 地名（テキスト）として既に公開している以上の情報は出ない。
 */
export default function MapPage() {
    const { locale } = useLocale();
    const { photos, loaded, failed } = usePhotos();
    const en = locale === "en";

    const geo = useMemo(() => photosWithCoords(photos.filter((p) => p.published !== false)), [photos]);
    const approxCount = useMemo(() => geo.filter((p) => p.geoApprox).length, [geo]);

    // ピンを押すと画面下のシートに出す（以前は地図の中のポップアップ）。
    // **押された束をそのまま持つ。** 束の中身は地図が決めた並びで、
    // シートは「1/5」で送るだけ
    const [selection, setSelection] = useState<MapSelection | null>(null);
    const closeSheet = useCallback(() => setSelection(null), []);
    const setIndex = useCallback((index: number) => {
        setSelection((s) => (s ? { ...s, index } : s));
    }, []);
    // **写真が全部消えたらシートも出さない。** 出しっぱなしだと、地図が
    // 「まだありません」に戻っているのにシートだけ残る。
    // 描画のときに決める——ここで `setState` すると描画が1回増える
    // （`react-hooks/set-state-in-render`）
    const sheet = geo.length > 0 ? selection : null;

    return (
        <main className="max-w-6xl mx-auto px-4 py-6 pb-28">
            <div className="flex items-baseline justify-between gap-3 mb-4">
                <h1 className="text-xl font-semibold">{en ? "Map" : "撮影地マップ"}</h1>
                {/* 届くまで枚数は出さない——「0枚」は「まだ分からない」と別 */}
                {(loaded || geo.length > 0) && (
                    <p className="text-sm text-white/50 tabular-nums">
                        {en
                            ? `${geo.length} photo${geo.length === 1 ? "" : "s"} with location`
                            : `位置情報のある写真 ${geo.length}枚`}
                    </p>
                )}
            </div>

            {geo.length === 0 && !loaded ? (
                // **まだ届いていないなら「まだ」と言わない。** 手元の断面に座標が
                // 無いだけで、API の一覧には有ることがある（実測: 4秒の回線で
                // 「0枚・まだありません」が出たあと 18枚に変わった）
                // `aria-busy` は「更新中だから待て」の合図。失敗の告知には付けない
                // （付いたままだと支援技術が読み上げを抑える）
                <div className="rounded-2xl ring-1 ring-white/10 bg-white/5 px-6 py-16 text-center text-white/60 text-sm" aria-busy={!failed}>
                    {failed
                        ? (en ? "Couldn't load photos. Check your connection and try again." : "写真を読み込めませんでした。通信を確かめて、もう一度お試しください。")
                        : (en ? "Loading…" : "読み込み中…")}
                </div>
            ) : geo.length === 0 ? (
                // **0枚は「まだ」と言う。** 位置情報は GPS 付きの写真を上げたとき、
                // または撮影地名から補ったとき・編集画面で選んだときに付く。
                // 無い状態を「地図が壊れた」と読ませない
                <div className="rounded-2xl ring-1 ring-white/10 bg-white/5 px-6 py-16 text-center text-white/60 text-sm">
                    <p>{en ? "No photos with location yet." : "位置情報のある写真はまだありません。"}</p>
                    <p className="mt-2 text-white/50">
                        {en
                            ? "Photos uploaded with GPS data, or given a place from the edit screen, appear here (rounded to about 1 km)."
                            : "GPS 付きの写真をアップロードするか、編集画面の「地図に出す位置」で場所を選ぶと、約1km の粒度でここに載ります。"}
                    </p>
                    <Link href={ROUTES.HOME} prefetch={false} className="inline-block mt-6 text-sky-300 hover:text-sky-200 underline underline-offset-4">
                        {en ? "Back to gallery" : "ギャラリーに戻る"}
                    </Link>
                </div>
            ) : (
                <>
                    <PhotoMap photos={geo} locale={locale} onSelect={setSelection} />
                    {/* 位置の出どころの断り。**小さい字なので色は薄くしない**
                        （white/40 は黒地で約3.7:1 ＝ 小さい文字の基準 4.5:1 に届かない） */}
                    <p className="mt-3 text-xs text-white/60">
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
                                {/* **撮影地が無い写真では、リンクの文字が id になっていた。**
                                    読み上げが36文字の UUID を読むことになる。この一覧は
                                    地図を操作できない人の唯一の経路なので、題 →「写真」へ落とす。

                                    **今の本番では起きない**（実測: 一覧に出る16件は全部
                                    撮影地を持つ）。いまの座標は `geocode-locations.js` が
                                    **地名から**引いたものだけなので、地名がある写真にしか
                                    付かないため。**GPS 付きのアップロード**
                                    （`api-user/src/upload.ts` の `sanitizeCoords`）では
                                    座標だけ入って撮影地は空になりうるので、予防で直す。
                                    空白だけの撮影地も落とす——`||` だけだと
                                    **名前の無いリンク**になり、id より悪い */}
                                <Link href={ROUTES.PHOTO(p.id)} prefetch={false}>
                                    {p.location?.trim() || getLocalized(p.title, locale) || (en ? "Photo" : "写真")}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {/* 押したピンの中身。**地図の外**に出すので、地図の高さに縛られない */}
            {sheet && (
                <MapPhotoSheet
                    photos={sheet.photos}
                    index={sheet.index}
                    onIndexChange={setIndex}
                    onClose={closeSheet}
                    locale={locale}
                />
            )}
        </main>
    );
}
