"use client";

import React from "react";
import Link from "next/link";
import { ChevronRightIcon, MapPinIcon } from "@heroicons/react/24/outline";
import type { MapPhoto } from "../components/PhotoMap";
import { getLocalized } from "../../lib/data/photos";
import { publicImageUrl } from "../../lib/utils/seo";
import { formatStoredDateTime } from "../../lib/utils/photoDate";
import { ROUTES } from "../../lib/routes";

/**
 * 地図に出ている写真の一覧（最終版モック `06-map.jpg` の⑤「リスト表示」）。
 *
 * **モックの行にある「❤️1.2K」「💬56」は出さない。** いいねの数は集計して
 * いるが、コメント数は数えていないし、並べると「人気」の表に見える
 * ——owner の指示（2026-09-22）で**人気・評価は出さない**。ここに出すのは
 * 写真が実際に持っている値（サムネ・題・撮影地・撮影日）だけ。
 *
 * **行そのものを写真ページへのリンクにする。** 以前この画面にあった
 * `sr-only` の一覧が持っていた役割（地図を操作できない人の唯一の経路）を
 * そのまま引き継ぐ。押すと選ぶだけ、にすると読み上げの人が写真に辿り着けない。
 *
 * **寸法は px。** 640px 未満で root が 14px に落ちるため。
 */
export default function MapPhotoList({ photos, locale, emptyHint }: {
    photos: readonly MapPhoto[];
    locale: "ja" | "en";
    /** 0件のときに添える一言（絞り込みで消えたのか、元々無いのか） */
    emptyHint?: string;
}) {
    const en = locale === "en";

    if (photos.length === 0) {
        return (
            <p
                className="rounded-2xl ring-1 ring-white/10 bg-white/5 text-center text-white/60"
                style={{ padding: "32px 16px", fontSize: "13px" }}
                data-testid="map-list-empty"
            >
                {emptyHint ?? (en ? "No photos match." : "該当する写真がありません。")}
            </p>
        );
    }

    return (
        <ul
            className="list-none m-0 p-0"
            aria-label={en ? "Photos on the map" : "地図上の写真"}
            data-testid="map-list"
        >
            {photos.map((p) => {
                const title = getLocalized(p.title, locale);
                const location = (p.location ?? "").trim();
                const date = formatStoredDateTime(p.date, locale)
                    ?? formatStoredDateTime(p.exif?.dateTimeOriginal, locale)
                    ?? "";
                // **撮影地を主にする。** 地図の一覧なので、探しているのは場所。
                // 撮影地が無い写真は題（それも無ければ「写真」）に落とす
                // ——リンクの名前が id になると読み上げが36文字の UUID を読む
                const primary = location || title || (en ? "Photo" : "写真");
                const secondary = location ? title : "";
                const thumb = p.thumbSm || p.thumbSrc || p.src;
                return (
                    <li key={p.id} style={{ marginBottom: "8px" }}>
                        <Link
                            href={ROUTES.PHOTO(p.id)}
                            prefetch={false}
                            className="flex items-center rounded-2xl bg-surface-2/70 ring-1 ring-white/10 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                            style={{ gap: "12px", padding: "8px" }}
                        >
                            <span
                                className="flex-shrink-0 block overflow-hidden rounded-xl bg-white/5"
                                style={{ width: "56px", height: "56px" }}
                            >
                                {thumb && (
                                    // 出す URL はサイトのドメインに揃える（`Thumb` と同じ理由）。
                                    // **`next/image` は使わない**——静的書き出しで最適化が効かない
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={publicImageUrl(thumb)}
                                        alt=""
                                        width={56}
                                        height={56}
                                        loading="lazy"
                                        decoding="async"
                                        className="w-full h-full object-cover"
                                    />
                                )}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center text-white truncate" style={{ gap: "4px", fontSize: "14px", lineHeight: "20px" }}>
                                    {location && <MapPinIcon aria-hidden="true" className="flex-shrink-0 text-accent" style={{ width: "14px", height: "14px" }} />}
                                    <span className="truncate">{primary}</span>
                                </span>
                                {secondary && (
                                    <span className="block truncate text-white/70" style={{ fontSize: "13px", lineHeight: "18px", marginTop: "2px" }}>
                                        {secondary}
                                    </span>
                                )}
                                {date && (
                                    // **小さい字なので色は薄くしない**（white/40 は紺地で
                                    // 約3.7:1 ＝ 小さい文字の基準 4.5:1 に届かない）
                                    <span className="block text-white/60 tabular-nums" style={{ fontSize: "12px", lineHeight: "16px", marginTop: "2px" }}>
                                        {date}
                                    </span>
                                )}
                            </span>
                            <ChevronRightIcon aria-hidden="true" className="flex-shrink-0 text-white/50" style={{ width: "18px", height: "18px" }} />
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}
