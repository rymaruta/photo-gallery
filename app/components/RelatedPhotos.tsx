"use client";

// 写真ページの回遊導線: 関連写真を横スクロールのサムネイル列で見せる。
// タップでその写真の個別ページへ遷移する（サイト内の内部リンク＝SEOにも有利）。

import React from "react";
import Thumb from "./Thumb";
import Link from "next/link";
import type { Photo } from "@/lib/data/photos";
import { photoOwnTitle } from "@/lib/utils/photoTitle";
import { relatedPhotoAlt } from "@/lib/utils/photoAlt";
import { ROUTES } from "../../lib/routes";

type Props = {
    title: string;
    photos: Photo[];
    locale: "ja" | "en";
    /**
     * 題も撮影地も alt も無い写真の alt（例「luzhjさんの写真」）。無ければ「写真」のまま。
     * 2026-10-22: 本番の写真ページで関連写真の alt が「写真」だけ4枚あった
     */
    fallbackAlt?: string;
};

export default function RelatedPhotos({ title, photos, locale, fallbackAlt }: Props) {
    if (!photos || photos.length === 0) return null;

    return (
        <section className="pt-5 border-t border-line">
            <h2 className="text-sm font-semibold text-white/70 mb-3">{title}</h2>
            {/* 横スクロール。スクロールバーは隠し、指/トラックパッドで流す */}
            <div className="flex gap-2.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1 snap-x snap-mandatory">
                {photos.map((p) => {
                    // 題は空なら出さない（旧い「無題」も落とす）。画像の alt は名前が要るので代わりの題
                    const t = photoOwnTitle(p, (locale === "en" ? "en" : "ja"));
                    const named = relatedPhotoAlt(p, locale, fallbackAlt);
                    return (
                        // **先読みしない。** 一覧で何本も出るリンクなので、画面に入るたびに
                        // 行き先の RSC の控え（`no-store` 配信）を落とし直す。理由と実測は
                        // `app/components/GalleryGrid.tsx` のカードのコメントに書いた
                        <Link
                            key={p.id}
                            href={ROUTES.PHOTO(p.id)}
                            prefetch={false}
                            data-photo-id={p.id}
                            className="group flex-shrink-0 w-28 sm:w-32 snap-start focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-lg"
                            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                            title={t}
                        >
                            <div
                                className="relative w-full overflow-hidden rounded-lg ring-1 ring-line"
                                style={{ paddingTop: "100%", backgroundColor: p.dominantColor ?? "var(--color-surface)" }}
                            >
                                <Thumb
                                    photo={p}
                                    alt={named}
                                    sizes="(max-width:640px) 112px, 128px"
                                    className="transition-transform duration-300 group-hover:scale-[1.05]"
                                />
                            </div>
                            {t && (
                                <p className="mt-1.5 text-[12px] leading-snug text-white/70 line-clamp-2">{t}</p>
                            )}
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}
