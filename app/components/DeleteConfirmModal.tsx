"use client";

import React from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import type { Photo } from "../data/photos";
import type { Locale } from "../data/photos";

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
                className="absolute inset-0 bg-black/70"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* モーダル本体 */}
            <div className="relative z-10 w-full max-w-sm bg-[#07090a] border border-white/20 rounded-xl shadow-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                        <TrashIcon className="w-5 h-5 text-red-400" />
                    </div>
                    <h2 className="text-lg font-semibold text-white">
                        {locale === "en" ? "Delete Photo" : "写真を削除"}
                    </h2>
                </div>

                <p className="text-white/70 text-sm mb-6">
                    {locale === "en"
                        ? `Are you sure you want to delete "${title || "this photo"}"? This action cannot be undone.`
                        : `「${title || "この写真"}」を削除しますか？この操作は元に戻せません。`}
                </p>

                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        disabled={deleting}
                        className="flex-1 px-4 py-2 rounded-md border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-colors text-sm disabled:opacity-50"
                    >
                        {locale === "en" ? "Cancel" : "キャンセル"}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={deleting}
                        className="flex-1 px-4 py-2 rounded-md bg-red-500 hover:bg-red-600 text-white font-medium transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {deleting ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                {locale === "en" ? "Deleting..." : "削除中..."}
                            </>
                        ) : (
                            locale === "en" ? "Delete" : "削除"
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
