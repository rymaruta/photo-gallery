"use client";

import React from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import type { Photo, Locale } from "@/lib/data/photos";

type Props = {
    photo: Photo | null;
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    locale: Locale;
    deleting: boolean;
};

export default function DeleteConfirmModal({ photo, isOpen, onClose, onConfirm, locale, deleting }: Props) {
    if (!isOpen || !photo) return null;

    const title = typeof photo.title === "string"
        ? photo.title
        : (photo.title?.[locale] ?? photo.title?.ja ?? photo.title?.en ?? "");

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* オーバーレイ */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* モーダル本体 */}
            <div className="relative z-10 w-full max-w-sm rounded-3xl bg-[#16181c] ring-1 ring-white/10 shadow-2xl p-6 text-center story-media-in">
                <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
                    <TrashIcon className="w-6 h-6 text-red-400" />
                </div>
                <h2 className="text-[15px] font-semibold text-white mb-1.5">
                    {locale === "en" ? "Delete this photo?" : "この写真を削除しますか？"}
                </h2>
                <p className="text-white/50 text-xs mb-6 leading-relaxed">
                    {title
                        ? (locale === "en" ? `"${title}" will be removed. This can't be undone.` : `「${title}」を削除します。この操作は取り消せません。`)
                        : (locale === "en" ? "This can't be undone." : "この操作は取り消せません。")}
                </p>

                <div className="flex flex-col gap-2">
                    <button
                        onClick={onConfirm}
                        disabled={deleting}
                        className="w-full py-3 rounded-full bg-red-500 hover:bg-red-600 active:scale-[0.98] transition text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
                        style={{ touchAction: "manipulation" }}
                    >
                        {deleting && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                        {deleting ? (locale === "en" ? "Deleting..." : "削除中...") : (locale === "en" ? "Delete" : "削除する")}
                    </button>
                    <button
                        onClick={onClose}
                        disabled={deleting}
                        className="w-full py-3 rounded-full text-white/70 hover:bg-white/5 active:scale-[0.98] transition text-sm font-medium disabled:opacity-50"
                        style={{ touchAction: "manipulation" }}
                    >
                        {locale === "en" ? "Cancel" : "キャンセル"}
                    </button>
                </div>
            </div>
        </div>
    );
}
