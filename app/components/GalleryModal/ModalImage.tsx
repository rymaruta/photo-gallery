"use client";
import React, { useState } from "react";
import { isImageReady } from "../../../lib/utils/imageReady";
import { dropCachedPhoto } from "../../../lib/utils/photoCache";
import { publicImageUrl } from "@/lib/utils/seo";

type Props = {
    src: string;
    alt: string;
    srcAvif?: string;
    focalPoint?: { x: number; y: number };
};

export default function ModalImage({ src, alt, srcAvif, focalPoint }: Props) {
    const [imageError, setImageError] = useState(false);
    const [imageLoading, setImageLoading] = useState(true);

    if (imageError) {
        return (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                <div className="text-white/60 text-center px-4">
                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm">画像を読み込めません</p>
                </div>
            </div>
        );
    }

    return (
        <>
            {imageLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            )}
            {/* AVIF があれば優先、無ければ従来 src(WebP) にフォールバック */}
            <picture>
                {srcAvif && <source type="image/avif" srcSet={publicImageUrl(srcAvif)} />}
                <img
                    src={publicImageUrl(src)}
                    alt={alt}
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                    decoding="async"
                    fetchPriority="high"
                    className="absolute inset-0 w-full h-full object-contain select-none"
                    style={{
                        WebkitTouchCallout: "none",
                        ...(focalPoint ? { objectPosition: `${focalPoint.x * 100}% ${focalPoint.y * 100}%` } : {}),
                    }}
                    onError={(e) => { setImageError(true); setImageLoading(false); void dropCachedPhoto(e.currentTarget.currentSrc || e.currentTarget.src); }}
                    onLoad={() => setImageLoading(false)}
                    // キャッシュ済みで load を取り逃した場合の保険（imageReady.ts 参照）
                    ref={(img) => { if (isImageReady(img)) setImageLoading(false); }}
                />
            </picture>
        </>
    );
}
