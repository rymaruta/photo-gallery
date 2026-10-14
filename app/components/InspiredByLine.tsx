"use client";

import React from "react";
import Link from "next/link";
import { getLocalized } from "@/lib/data/photos";
import type { InspiredLink } from "@/lib/utils/inspired";
import { publicImageUrl } from "@/lib/utils/seo";
import { ROUTES } from "@/lib/routes";

/**
 * 写真ページの**「この写真を見て撮影」**の小さな行（元の写真の小さい画像・題・作者・リンク）。
 *
 * owner のめざす姿「写真から、次の旅が始まるSNS」——人の写真を見てその場所へ
 * 行った人が、元の写真を付けて投稿する（`api-user/src/inspired.ts`）。
 *
 * **元の写真が見つからなければ何も描かない**（非公開・削除・絞った写真）。
 * 見つけるのは呼び手（`lib/utils/inspired.ts` の `inspiredSourceFor`）。
 *
 * 見た目は撮影スポットのカード（`SpotLinkCard`）に揃える（新しい見た目を増やさない）。
 * 行全体を1つのリンクにして、押せる高さ（44px 以上）を取る。
 */
export default function InspiredByLine({ source, locale }: { source: InspiredLink | null; locale: string }) {
    if (!source) return null;
    const isJa = locale !== "en";
    const title = getLocalized(source.title, isJa ? "ja" : "en")
        || getLocalized(source.title, isJa ? "en" : "ja")
        || (isJa ? "無題" : "Untitled");
    const label = isJa ? "この写真を見て撮影" : "Inspired by this photo";
    return (
        <section className="mt-1" aria-label={label} data-testid="inspired-by">
            <Link href={ROUTES.PHOTO(source.id)} prefetch={false}
                  className="flex items-center gap-3 rounded-2xl bg-surface ring-1 ring-line p-2.5 hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={publicImageUrl(source.thumb)} alt="" loading="lazy" decoding="async"
                     className="flex-shrink-0 rounded-xl object-cover bg-surface-2"
                     style={{ width: "48px", height: "48px" }} />
                <span className="min-w-0 flex-1">
                    <span className="block text-white/60" style={{ fontSize: "12px", lineHeight: "16px" }}>{label}</span>
                    <span className="block text-white font-semibold truncate" style={{ fontSize: "14px", lineHeight: "20px" }}>{title}</span>
                    {source.displayName && (
                        <span className="block text-white/50 truncate" style={{ fontSize: "12px", lineHeight: "16px" }}>
                            {isJa ? `${source.displayName} さんの写真` : `Photo by ${source.displayName}`}
                        </span>
                    )}
                </span>
            </Link>
        </section>
    );
}
