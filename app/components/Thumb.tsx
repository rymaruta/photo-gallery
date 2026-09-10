"use client";

import React, { useCallback, useState, useSyncExternalStore } from "react";
import type { Photo } from "@/lib/data/photos";
import { isImageReady } from "@/lib/utils/imageReady";

/** 256w/512w の srcset 文字列を組み立てる（無い分は除外） */
function buildSrcSet(w256?: string, w512?: string): string | undefined {
    const parts: string[] = [];
    if (w256) parts.push(`${w256} 256w`);
    if (w512) parts.push(`${w512} 512w`);
    return parts.length ? parts.join(", ") : undefined;
}


/**
 * この描画が「ハイドレーション」（静的HTMLに React を付けている）かどうか。
 * サーバー側の値（false）はハイドレーションの最初の描画でだけ使われ、
 * クライアント遷移で新しく作られた部品は最初から true。
 * **ハイドレーション由来の `<img>` は隠さない**——Chromium は JPEG/WebP を
 * 届いた行まで逐次描くので、途中まで見えている写真を React が付いた瞬間に
 * `opacity-0` にすると「見えた → 消える → 出る」になる。ブラウザに任せ、
 * 届いたら（onLoad）ぼかしを外すだけ。フェードで出すのは、クライアント遷移で
 * 新しく作った `<img>`（作った瞬間に隠すので何も描かれていない）だけ
 */
const subscribeNoop = () => () => {};
function useHydratedFromHtml(): boolean {
    const clientRender = useSyncExternalStore(subscribeNoop, () => true, () => false);
    // 最初の描画の値だけを覚える（あとで true に変わっても、この部品が
    // 静的HTML由来であることは変わらない）。初期化関数は最初の描画でしか走らない
    const [fromHtml] = useState(() => !clientRender);
    return fromHtml;
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
    // まだ何も届いていない `<img>` は何も描かない（下のぼかしが透ける。実測）ので、
    // 「まだ分からない」間は見せておいて損が無い。React が付いた時点（ref）で
    // 「もう届いている／まだ」を見る。まだなら: 静的HTML由来は見せたまま
    // （途中まで描かれているかもしれない。`useHydratedFromHtml` を参照）、
    // クライアント遷移で作った `<img>` は隠してフェードで出す
    const [phase, setPhase] = useState<"unknown" | "pending" | "loaded">("unknown");
    const fromHtml = useHydratedFromHtml();
    const [error, setError] = useState(false);
    // ref は `useCallback` で固定する（描画のたびに作り直すと React が毎回
    // 外して付け直す。jsdom では `naturalWidth` が常に 0 なので、その再呼び出しで
    // 届いたあとに `pending` へ戻った——実ブラウザでは戻らないが、無駄な往復）
    const attach = useCallback((img: HTMLImageElement | null) => {
        if (!img) return;
        // ref は commit の中で呼ばれ、ここでの setState は描画前に反映される。
        // **React より先に失敗が終わっていた画像**（静的HTMLに残った削除済み写真の
        // 404 など）は `complete` なのに実体が無い。`error` は既に発火済みで
        // React には来ないので、ここで失敗の絵に切り替える（放っておくと、
        // 隠さない設計にしたぶんブラウザの破損表示が上に出る）
        if (img.complete && img.naturalWidth === 0) { setError(true); return; }
        if (isImageReady(img)) setPhase("loaded");
        else if (!fromHtml) setPhase("pending");
    }, [fromHtml]);
    const loaded = phase === "loaded";

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
