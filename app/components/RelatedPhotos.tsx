"use client";

// 写真ページの回遊導線: 関連写真を 4 列の格子で見せる（iOS の「この近くで撮られた写真」と同じ形）。
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

/**
 * 2026-10-31 判断（束 1 P11）: **iOS の「この近くで撮られた写真」と同じ形**——明朝 18 の見出し、4 列・すき間 2・
 * 外の角 12（`rounded-field`）の格子（題は出さない。題は alt と title が持つ）。以前は 112px の横に流れる帯に題 2 行つき、
 * 見出しは 14 の灰の太字で、コメントと「関連写真」のタブの中にあった。並べる数（最大 8）は変えない
 * ——写真から写真への内部リンク（SEO・回遊）を減らさない
 */
export default function RelatedPhotos({ title, photos, locale, fallbackAlt }: Props) {
    if (!photos || photos.length === 0) return null;

    return (
        <section className="flex flex-col gap-[10px]" data-testid="related-photos">
            <h2 className="m-0 font-serif font-bold text-white" style={{ fontSize: "18px", lineHeight: "24px" }}>{title}</h2>
            <div className="grid grid-cols-4 gap-0.5 rounded-field overflow-hidden">
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
                            className="relative block focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                            style={{ aspectRatio: "1 / 1", backgroundColor: p.dominantColor ?? "var(--color-surface)", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                            title={t || undefined}
                        >
                            <Thumb photo={p} alt={named} sizes="(max-width:640px) 25vw, 120px" />
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}
