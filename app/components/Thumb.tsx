"use client";

import React, { useCallback, useState } from "react";
import type { Photo } from "@/lib/data/photos";
import { isImageReady } from "@/lib/utils/imageReady";

/** 256w/512w の srcset 文字列を組み立てる（無い分は除外） */
function buildSrcSet(w256?: string, w512?: string): string | undefined {
    const parts: string[] = [];
    if (w256) parts.push(`${w256} 256w`);
    if (w512) parts.push(`${w512} 512w`);
    return parts.length ? parts.join(", ") : undefined;
}

type Props = {
    photo: Pick<Photo, "src" | "thumbSrc" | "thumbAvif" | "thumbSm" | "thumbSmAvif" | "blurDataURL">;
    alt: string;
    sizes?: string;
    priority?: boolean;
    objectPosition?: string;
    className?: string;
};

/**
 * グリッド用サムネイル。<picture> で AVIF/WebP・256/512 を出し分け、
 * 存在する派生だけ <source> にする（無ければ従来 thumbSrc/src にフォールバック）。
 * 親の相対配置ボックスに absolute で敷き詰める前提。blur-up・フェード・エラー処理を内包。
 */
export default function Thumb({ photo, alt, sizes, priority = false, objectPosition, className = "" }: Props) {
    // **ハイドレーションまでは隠さない。** 以前は `loaded=false` から始めて
    // `opacity-0` を静的HTMLに焼いていたので、JS が届いて React が付くまで
    // 画像が透明のままだった（Chromium 実測・Fast 3G + CPU 4倍: 画像は
    // 1.6秒で届いているのに見えるのは 5.9秒。その間はぼかしだけ）。
    // 読み込み中の `<img>` は何も描かない（下のぼかしが透ける。実測）ので、
    // 「まだ分からない」間は見せておいて損が無い。React が付いた時点
    // （ref）で「もう届いている／まだ」を見て、まだなら隠してフェードで出す
    const [phase, setPhase] = useState<"unknown" | "pending" | "loaded">("unknown");
    const attach = useCallback((img: HTMLImageElement | null) => {
        if (!img) return;
        // ref は commit の中で呼ばれ、ここでの setState は描画前に反映される
        // ——「見える → 隠す」の一瞬は出ない
        setPhase(isImageReady(img) ? "loaded" : "pending");
    }, []);
    const loaded = phase === "loaded";
    const [error, setError] = useState(false);

    const fallback = photo.thumbSrc || photo.src;
    const avifSet = (photo.thumbSmAvif || photo.thumbAvif) ? buildSrcSet(photo.thumbSmAvif, photo.thumbAvif) : undefined;
    const webpSet = photo.thumbSm ? buildSrcSet(photo.thumbSm, photo.thumbSrc) : undefined;

    if (error) {
        return (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                <svg className="w-8 h-8 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden={true}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
            </div>
        );
    }

    return (
        <>
            {/* blur-up: ぼかしプレビューを即表示。本画像ロードで上にフェード */}
            {photo.blurDataURL && !loaded && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={photo.blurDataURL}
                    alt=""
                    aria-hidden={true}
                    draggable={false}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ filter: "blur(12px)", transform: "scale(1.1)", ...(objectPosition ? { objectPosition } : {}) }}
                />
            )}
            <picture>
                {avifSet && <source type="image/avif" srcSet={avifSet} sizes={sizes} />}
                {webpSet && <source type="image/webp" srcSet={webpSet} sizes={sizes} />}
                <img
                    ref={attach}
                    src={fallback}
                    alt={alt}
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                    loading={priority ? "eager" : "lazy"}
                    fetchPriority={priority ? "high" : "auto"}
                    decoding="async"
                    onLoad={() => setPhase("loaded")}
                    onError={() => setError(true)}
                    className={`absolute inset-0 w-full h-full object-cover select-none transition-opacity duration-500 ${phase === "pending" ? "opacity-0" : "opacity-100"} ${className}`}
                    style={{ WebkitTouchCallout: "none", ...(objectPosition ? { objectPosition } : {}) }}
                />
            </picture>
        </>
    );
}

// テスト用: srcset 組み立ての純関数
export { buildSrcSet };
