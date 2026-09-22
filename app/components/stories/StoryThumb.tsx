"use client";

import React from "react";
import { publicImageUrl } from "@/lib/utils/seo";
import type { Story } from "@/lib/stories";

/**
 * ストーリー1枚の静止した絵（枠いっぱいに `object-cover`）。
 *
 * アーカイブのタイル・ハイライトの輪・表紙の選択が同じ絵を描く——
 * 3か所に同じ `<video>` / `<img>` を書くと、iOS の黒い箱の対策
 * （下の `#t=`）を1か所だけ直す形になる。親が `relative` な箱を持つ。
 */
export default function StoryThumb({ src, mediaType, className = "" }: {
    src: string;
    mediaType?: Story["mediaType"];
    className?: string;
}) {
    const cls = `absolute inset-0 w-full h-full object-cover ${className}`;
    if (mediaType === "video") {
        // 最初のフレームを出す。iOS Safari は `#t=` の欠片が無いと
        // 再生するまで何も描かない（黒い箱になる）。音は出さない
        return <video src={`${publicImageUrl(src)}#t=0.001`} muted playsInline preload="metadata" className={cls} />;
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={publicImageUrl(src)} alt="" loading="lazy" className={cls} />;
}
