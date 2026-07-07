"use client";
import React from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import { HeartIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartIconOutline } from "@heroicons/react/24/outline";

const BTN_BASE =
    "absolute rounded-full bg-black/30 ring-1 ring-white/10 hover:bg-black/50 active:scale-95 " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 shadow-lg transition z-20";

const BTN_STYLE: React.CSSProperties = {
    backdropFilter: "blur(8px)",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
    minWidth: "44px",
    minHeight: "44px",
    padding: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "auto",
};

type Props = {
    onPrev: () => void;
    onNext: () => void;
    onClose: () => void;
    isFav: boolean;
    onToggleFavorite: () => void;
    firstFocusableRef: React.RefObject<HTMLButtonElement | null>;
    lastFocusableRef: React.RefObject<HTMLButtonElement | null>;
};

export default function ModalControls({
    onPrev, onNext, onClose, isFav, onToggleFavorite,
    firstFocusableRef, lastFocusableRef,
}: Props) {
    const stopAndCall = (fn: () => void) => ({
        onClick: (e: React.MouseEvent) => { e.stopPropagation(); fn(); },
    });

    return (
        <>
            {/* 前へ */}
            <button
                ref={firstFocusableRef}
                {...stopAndCall(onPrev)}
                aria-label="Previous"
                className={`${BTN_BASE} left-2 sm:left-3 top-1/2 transform -translate-y-1/2`}
                style={BTN_STYLE}
            >
                <ArrowLeftIcon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </button>

            {/* 次へ */}
            <button
                {...stopAndCall(onNext)}
                aria-label="Next"
                className={`${BTN_BASE} right-2 sm:right-3 top-1/2 transform -translate-y-1/2`}
                style={BTN_STYLE}
            >
                <ArrowRightIcon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </button>

            {/* お気に入り（閉じるボタンは right-2 + 幅44px ≈ 52px を占有するため、重ならないよう 64px 以上離す） */}
            <button
                {...stopAndCall(onToggleFavorite)}
                aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                className={`${BTN_BASE} top-2 sm:top-3 right-[64px] sm:right-[72px]`}
                style={BTN_STYLE}
            >
                {isFav
                    ? <HeartIcon className="w-5 h-5 sm:w-6 sm:h-6 text-red-500" />
                    : <HeartIconOutline className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                }
            </button>

            {/* 閉じる */}
            <button
                ref={lastFocusableRef}
                {...stopAndCall(onClose)}
                aria-label="Close"
                className={`${BTN_BASE} top-2 sm:top-3 right-2 sm:right-3`}
                style={BTN_STYLE}
            >
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </>
    );
}
