"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { CameraIcon } from "@heroicons/react/24/solid";
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
 * **寸法は px。** 以前は 640px 未満で root が 14px に落ちていた（2026-10-30 束 0a で外した）。
 */
/** 最初に並べる件数。**全件（1,079件）を一度に並べない**——PC でも一覧が縦に伸び続け、
 *  写真の一覧に届かない。絞り込み（語・範囲）で減らすのが本筋で、残りは押して足す */
const PAGE = 30;

export default function MapSpotList({ spots, total = spots.length, categoryActive = false, searching = false, locale }: {
    /** 絞り込み（語・カテゴリ・範囲）を通したあとのスポット */
    spots: readonly SpotPin[];
    /** 絞る前の件数（0 なら台帳が空＝節ごと出さない） */
    total?: number;
    /** 写真のカテゴリで絞っている（スポットは出さない・`filterMapSpots`） */
    categoryActive?: boolean;
    /** 名前の索引を待っている（読み・英語名で当たるかまだ分からない） */
    searching?: boolean;
    locale: "ja" | "en";
}) {
    const en = locale === "en";
    // 何件まで出すか。**絞り込みが変わったら（配列が変わったら）先頭の30件に戻る**
    // ——どの配列に対する件数かを一緒に持つ（effect で戻さない）
    const [pager, setPager] = useState<{ of: readonly SpotPin[]; n: number }>({ of: spots, n: PAGE });
    const limit = pager.of === spots ? pager.n : PAGE;
    if (total === 0) return null;
    // **絞った結果が0件でも節は消さない**——消すと「スポットが無い」のか「絞りで消えた」のか
    // 分からない。理由を1行で言う
    if (spots.length === 0) {
        return (
            <section aria-labelledby="map-spot-list-heading" style={{ marginTop: "12px" }}>
                <h2 id="map-spot-list-heading" className="m-0 font-serif font-bold text-white"
                    style={{ fontSize: "14px", lineHeight: "20px", marginBottom: "4px" }}>
                    {en ? "Photo spots" : "撮影スポット"}
                </h2>
                <p className="m-0 text-white/70" style={{ fontSize: "13px", lineHeight: "20px" }} data-testid="map-spot-empty">
                    {categoryActive
                        ? (en ? "Categories filter photos only, so spots are hidden. Choose “All” to see spots."
                            : "カテゴリは写真の分類なので、絞っている間は撮影スポットを出していません。「すべて」に戻すと出ます。")
                        : searching
                            ? (en ? "Searching spots…" : "撮影スポットを探しています…")
                            : (en ? "No spots match the search or area." : "検索語や範囲に当たる撮影スポットはありません。")}
                </p>
            </section>
        );
    }
    const shown = spots.slice(0, limit);

    return (
        <section aria-labelledby="map-spot-list-heading" style={{ marginTop: "12px" }}>
            <h2
                id="map-spot-list-heading"
                className="m-0 font-serif font-bold text-white"
                style={{ fontSize: "14px", lineHeight: "20px", marginBottom: "8px" }}
            >
                {/* 全部が下書きなら見出しもそう名乗る（「公式」は人が確かめた行だけ） */}
                {spots.every((s) => s.stage !== "published")
                    ? (en ? "Shooting spots (drafts)" : "撮影スポット（下書き）")
                    : (en ? "Photo spots" : "撮影スポット")}
            </h2>
            {/* iOS の地図のリストの行（`PhotoMapView.spotRow`・板 MapList・2026-10-31 束 2 M1）:
                札に入れず黒地に直に、行の下に白8%の線・高さ 64。左に地図のピンと同じ印（写真があれば写真の丸 40・
                真鍮の縁 2、無ければ真鍮の丸に墨のカメラ・白92%の縁 2）→ 明朝 18 の名前 → 12 の副（text-3）→ ›。
                以前は面の札（角 16）に 56 の四角い写真・14 の名前だった */}
            <ul className="list-none m-0 p-0" data-testid="map-spot-list">
                {shown.map((s) => (
                    <li key={s.slug}>
                        <Link
                            href={`${ROUTES.SPOTS}/${s.slug}`}
                            prefetch={false}
                            className="flex items-center min-h-[64px] py-3 border-b border-line hover:bg-white/5 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                            style={{ gap: "12px" }}
                            data-testid="map-spot-row"
                        >
                            {/* 代表写真。**権利の判断はサーバー側で済んでいる**ので、
                                在れば出す・無ければ真鍮の丸にカメラの印を置くだけ */}
                            {s.cover ? (
                                <span className="flex-shrink-0 block overflow-hidden rounded-full bg-accent ring-2 ring-inset ring-accent"
                                      style={{ width: "40px", height: "40px" }}>
                                    <img
                                        src={s.cover.src}
                                        alt=""
                                        width={40}
                                        height={40}
                                        loading="lazy"
                                        decoding="async"
                                        className="w-full h-full object-cover rounded-full"
                                        style={{ padding: "2px" }}
                                    />
                                </span>
                            ) : (
                                <span className="flex-shrink-0 inline-flex items-center justify-center rounded-full bg-accent text-ink"
                                      style={{ width: "40px", height: "40px", boxShadow: "inset 0 0 0 2px rgb(255 255 255 / 0.92)" }}>
                                    <CameraIcon className="w-[16px] h-[16px]" aria-hidden="true" />
                                </span>
                            )}
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-serif font-bold text-white" style={{ fontSize: "18px", lineHeight: "24px" }}>
                                    {s.name}
                                </span>
                                <span className="block truncate text-text-3 tabular-nums" style={{ fontSize: "12px", lineHeight: "16px", marginTop: "2px" }}>
                                    {s.stage === "published"
                                        ? (en ? "Photo spot" : "撮影スポット")
                                        : (en ? "Photo spot (draft)" : "撮影スポット（下書き）")}
                                    {s.region ? ` ・ ${s.region}` : ""}
                                </span>
                            </span>
                            <ChevronRightIcon aria-hidden="true" className="flex-shrink-0 text-text-3" style={{ width: "14px", height: "14px", strokeWidth: 2 }} />
                        </Link>
                    </li>
                ))}
            </ul>
            {spots.length > limit && (
                <button type="button" onClick={() => setPager({ of: spots, n: limit + PAGE })}
                        className="rounded-full px-4 text-white/80 ring-1 ring-line hover:bg-white/10"
                        style={{ minHeight: "44px", fontSize: "13px" }}
                        data-testid="map-spot-more">
                    {en ? `Show more (${spots.length - limit} left)` : `さらに表示（残り${spots.length - limit}か所）`}
                </button>
            )}
        </section>
    );
}
