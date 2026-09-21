"use client";

import React, { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { MapPhoto } from "../components/PhotoMap";
import { getLocalized, getLocalizedParagraphs } from "../../lib/data/photos";
import { formatStoredDateTime } from "../../lib/utils/photoDate";
import { publicImageUrl } from "../../lib/utils/seo";
import { ROUTES } from "../../lib/routes";

/**
 * 撮影地マップで押したピンの中身を出す、画面下のシート。
 *
 * **地図の中（Leaflet のポップアップ）から出した。** あそこは地図の高さに
 * 縛られるので、低い画面では中身が枠の外へ出ていた（実測 390x844 で3枚
 * 465px・地図の上へ 183px はみ出し、3枚のうち1枚は表示も操作もできなかった）。
 * さらに画像が遅れて入るたびに測り直しが走り、その測り直しが横送りの位置を
 * 先頭へ巻き戻していた——**送る操作そのものが送れなくなっていた。**
 *
 * **寸法は全部 px。** 640px 未満で root が 14px に落ちる（`app/globals.css`）
 * ので、rem で書くとスマホだけ縮む。
 *
 * **`--bottom-bar-h` のぶん持ち上げる。** 画面下に固定したバーがあるページ
 * では、バー自身が実測値をこの変数に出す（`lib/hooks/useBottomBarHeight.ts`）。
 * 決め打ちの高さで避けると、ラベルが折り返した幅で数px重なる（MiniPlayer が
 * 実際に踏んだ）。**こちらは変数を出さない**——出す側が2つになると、
 * 後からマウントした方が上書きして静かにずれる。
 */
export default function MapPhotoSheet({ photos, index, onIndexChange, onClose, locale }: {
    photos: readonly MapPhoto[];
    index: number;
    onIndexChange: (next: number) => void;
    onClose: () => void;
    locale: "ja" | "en";
}) {
    const en = locale === "en";
    const total = photos.length;
    // **範囲に丸める。** 束が描き直されて枚数が減ったときに、
    // `photos[index]` が undefined になって画面ごと落ちるのを防ぐ
    const safeIndex = total === 0 ? 0 : Math.min(Math.max(index, 0), total - 1);
    const photo = photos[safeIndex];

    const closeRef = useRef<HTMLButtonElement | null>(null);
    const go = useCallback((delta: number) => {
        if (total < 2) return;
        // 端では折り返す（モーダルの前後送りと同じ）
        onIndexChange((safeIndex + delta + total) % total);
    }, [safeIndex, total, onIndexChange]);

    // Escape で閉じる・左右で送る。**`window` に張る**——シートの中に
    // フォーカスが無くても（地図を触ったあとでも）効かせたい
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
            if (e.key === "ArrowRight") { e.preventDefault(); go(1); return; }
            if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); return; }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose, go]);

    if (!photo) return null;

    const title = getLocalized(photo.title, locale) || (en ? "Untitled" : "無題");
    const location = typeof photo.location === "string" ? photo.location.trim() : "";
    // 説明は1段落だけ出す（シートは一覧の入口で、全文は個別ページ）
    const description = getLocalizedParagraphs(photo.description, locale)[0] ?? "";
    // 撮影日。owner が入力した `date` を先に見て、無ければ EXIF。
    // **`toLocaleString` は使わない**——静的書き出しは UTC で走るので、
    // 閲覧者のゾーンとの食い違いでハイドレーションがずれ、日付だけの値は
    // UTC より西で前日になる（`lib/utils/photoDate.ts`）
    const date = formatStoredDateTime(photo.date, locale)
        ?? formatStoredDateTime(photo.exif?.dateTimeOriginal, locale)
        ?? "";
    const thumb = photo.thumbSrc || photo.src;

    return (
        <div
            role="dialog"
            aria-modal="false"
            aria-label={en ? "Photo at this location" : "この場所の写真"}
            className="fixed left-0 right-0 z-40 pointer-events-none"
            style={{
                // 画面下から。バーがあるページではそのぶん上へ
                bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px + var(--bottom-bar-h, 0px))",
                paddingLeft: "12px",
                paddingRight: "12px",
            }}
            data-testid="map-photo-sheet"
        >
            <div
                className="pointer-events-auto mx-auto rounded-2xl bg-[#16181c]/95 backdrop-blur-md ring-1 ring-white/15 shadow-2xl shadow-black/50"
                style={{ maxWidth: "560px", padding: "12px" }}
            >
                <div className="flex items-start" style={{ gap: "12px" }}>
                    {/* サムネ。**押せる**——一番大きい当たりが何もしないのは導線の穴。
                        題がリンクの読み上げ名になるので、画像の alt は空のまま */}
                    <Link
                        href={ROUTES.PHOTO(photo.id)}
                        prefetch={false}
                        className="flex-shrink-0 block rounded-xl overflow-hidden bg-white/5"
                        style={{ width: "72px", height: "72px" }}
                        aria-label={title}
                    >
                        {thumb && (
                            // 出すURLはサイトのドメインに揃える（`Thumb` と同じ理由）。
                            // **`next/image` は使わない**——静的書き出しで最適化が
                            // 効かず、別オリジンの設定も要るので、ここは素の img
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={publicImageUrl(thumb)}
                                alt=""
                                width={72}
                                height={72}
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover"
                            />
                        )}
                    </Link>

                    <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between" style={{ gap: "8px" }}>
                            <Link
                                href={ROUTES.PHOTO(photo.id)}
                                prefetch={false}
                                className="min-w-0 font-medium text-white hover:text-white/80 break-words"
                                style={{ fontSize: "15px", lineHeight: "20px" }}
                            >
                                {title}
                            </Link>
                            <button
                                ref={closeRef}
                                onClick={onClose}
                                aria-label={en ? "Close" : "閉じる"}
                                className="flex-shrink-0 -m-1 p-1 rounded-full text-white/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                                style={{ minWidth: "32px", minHeight: "32px", touchAction: "manipulation" }}
                            >
                                <XMarkIcon className="w-5 h-5 mx-auto" />
                            </button>
                        </div>

                        {location && (
                            <p className="truncate text-white/60" style={{ fontSize: "13px", marginTop: "2px" }} title={location}>
                                {location}
                            </p>
                        )}

                        {description && (
                            // 2行で切る（シートは入口で、全文は個別ページ）
                            <p
                                className="text-white/70 break-words"
                                style={{
                                    fontSize: "13px", lineHeight: "18px", marginTop: "6px",
                                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                                }}
                            >
                                {description}
                            </p>
                        )}

                        <div className="flex items-center justify-between" style={{ gap: "8px", marginTop: "8px" }}>
                            {/* 日付。**小さい字なので色は薄くしない**（white/40 は
                                黒地で約3.7:1＝小さい文字の基準 4.5:1 に届かない） */}
                            <p className="text-white/60 tabular-nums" style={{ fontSize: "12px" }}>{date}</p>

                            {/* 何枚目か。**1枚のときは出さない**——「1/1」と
                                送れない矢印は、押せるものが無いことしか伝えない */}
                            {total > 1 && (
                                <div className="flex items-center flex-shrink-0" style={{ gap: "2px" }}>
                                    <button
                                        onClick={() => go(-1)}
                                        aria-label={en ? "Previous photo" : "前の写真"}
                                        className="rounded-full text-white/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                                        style={{ minWidth: "32px", minHeight: "32px", touchAction: "manipulation" }}
                                    >
                                        <ChevronLeftIcon className="w-4 h-4 mx-auto" />
                                    </button>
                                    <span
                                        className="text-white/60 tabular-nums text-center"
                                        style={{ fontSize: "12px", minWidth: "32px" }}
                                        // 送るたびに読み上げる（見えている数字と同じことを言う）
                                        aria-live="polite"
                                    >
                                        {safeIndex + 1}/{total}
                                    </span>
                                    <button
                                        onClick={() => go(1)}
                                        aria-label={en ? "Next photo" : "次の写真"}
                                        className="rounded-full text-white/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                                        style={{ minWidth: "32px", minHeight: "32px", touchAction: "manipulation" }}
                                    >
                                        <ChevronRightIcon className="w-4 h-4 mx-auto" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
