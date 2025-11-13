// components/ProtectedPortrait.tsx
"use client";

import React from "react";
import Image from "next/image";

type Props = {
    src: string;
    alt?: string;
    sizes?: string;
    className?: string;
};

export default function ProtectedPortrait({
    src,
    alt = "portrait",
    sizes,
    className = "",
}: Props) {
    // ブラウザのコンテキストメニュー / ドラッグ をブロック
    const onContextMenu = (e: React.MouseEvent) => e.preventDefault();
    const onDragStart = (e: React.DragEvent) => e.preventDefault();

    return (
        <div
            className={`relative rounded-full overflow-hidden bg-gray-900 ring-1 ring-white/6 ${className}`}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart as any}
            // モバイルの長押しメニューを抑止するための style
            style={{
                WebkitUserSelect: "none",
                userSelect: "none",
                WebkitTouchCallout: "none",
                touchAction: "manipulation",
            }}
        >
            {/* 画像自体はドラッグ不可、pointer-events を none にして直接操作不可にする */}
            <Image
                src={src}
                alt={alt}
                width={880}
                height={880}
                sizes={sizes}
                draggable={false}
                onContextMenu={onContextMenu}
                onDragStart={onDragStart as any}
                className="w-full h-full object-cover object-center select-none pointer-events-none"
                priority
            />

            {/* 透明レイヤー：長押しやタップのイベントを吸収して保存メニューを出しにくくする */}
            <div
                aria-hidden
                className="absolute inset-0 z-20"
                style={{
                    WebkitUserSelect: "none",
                    userSelect: "none",
                    WebkitTouchCallout: "none",
                    pointerEvents: "auto",
                }}
            />
        </div>
    );
}
