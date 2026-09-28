"use client";

// 写真ページの回遊導線: 関連写真を横スクロールのサムネイル列で見せる。
// タップでその写真の個別ページへ遷移する（サイト内の内部リンク＝SEOにも有利）。

import React from "react";
import Thumb from "./Thumb";
import Link from "next/link";
import type { Photo } from "@/lib/data/photos";
import { getLocalized } from "@/lib/data/photos";
import { ROUTES } from "../../lib/routes";

type Props = {
    title: string;
    photos: Photo[];
    locale: "ja" | "en";
};

export default function RelatedPhotos({ title, photos, locale }: Props) {
    if (!photos || photos.length === 0) return null;

    return (
        <section className="pt-5 border-t border-white/10">
            <h2 className="text-sm font-semibold text-white/70 mb-3">{title}</h2>
            {/* 横スクロール。スクロールバーは隠し、指/トラックパッドで流す */}
            <div className="flex gap-2.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1 snap-x snap-mandatory">
                {photos.map((p) => {
                    const t = getLocalized(p.title, locale) || (typeof p.title === "string" ? p.title : "");
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
                                className="relative w-full overflow-hidden rounded-lg ring-1 ring-white/10"
                                style={{ paddingTop: "100%", backgroundColor: p.dominantColor ?? "#121212" }}
                            >
                                <Thumb
                                    photo={p}
                                    alt={t}
                                    sizes="(max-width:640px) 112px, 128px"
                                    className="transition-transform duration-300 group-hover:scale-[1.05]"
                                />
                            </div>
                            {t && (
                                <p className="mt-1.5 text-[11px] leading-snug text-white/70 line-clamp-2">{t}</p>
                            )}
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}
