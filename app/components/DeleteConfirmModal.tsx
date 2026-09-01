"use client";

import React, { useRef, useEffect } from "react";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/utils/scrollLock";
import { TrashIcon } from "@heroicons/react/24/outline";
import type { Photo, Locale } from "@/lib/data/photos";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";

type Props = {
    photo: Photo | null;
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    locale: Locale;
    deleting: boolean;
};

export default function DeleteConfirmModal({ photo, isOpen, onClose, onConfirm, locale, deleting }: Props) {
    // **フックは早期 return より前に置く。** 開いている間だけ有効にしたいが、
    // 条件を `if` で分けるとレンダーごとにフックの数が変わって React が壊れる。
    // 削除中は閉じさせない（オーバーレイのクリックと同じ扱い）
    useEscapeKey(isOpen && !deleting, onClose);
    // Tab を中に閉じ込める。裏側は管理画面の一覧（各行に編集・削除がある）で、
    // 見えないまま Enter で押せてしまう
    const dialogRef = useRef<HTMLDivElement | null>(null);
    // **最初に当てるのはキャンセル。** DOM 順の先頭は赤い「削除する」で、
    // 開いた瞬間に確定操作へフォーカスが乗っていた。前は起動元に残って
    // いたので、確認シートの上で Enter を打っても何も起きなかった。
    const cancelRef = useRef<HTMLButtonElement | null>(null);
    useFocusTrap(isOpen, dialogRef, undefined, cancelRef);
    // **背景を止める。** `fixed inset-0` の確認シートなのにロックが無く、
    // 上で指を動かすと裏の一覧がスクロールしていた（閉じると別の場所に
    // いる）。数を数える共通実装なので、他のロックと入れ子でも壊れない
    useEffect(() => {
        if (!isOpen) return;
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, [isOpen]);

    if (!isOpen || !photo) return null;

    const title = typeof photo.title === "string"
        ? photo.title
        : (photo.title?.[locale] ?? photo.title?.ja ?? photo.title?.en ?? "");

    return (
        <div
            ref={dialogRef}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={locale === "en" ? "Delete this photo?" : "この写真を削除しますか？"}
        >
            {/* オーバーレイ */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* モーダル本体 */}
            <div className="relative z-10 w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#1c1f25] to-[#141619] ring-1 ring-white/10 shadow-2xl shadow-black/60 p-6 pt-7 text-center story-media-in">
                <div className="relative w-14 h-14 rounded-full bg-red-500/12 ring-1 ring-red-500/25 flex items-center justify-center mx-auto mb-4">
                    <div className="absolute inset-0 rounded-full bg-red-500/20 blur-xl" aria-hidden="true" />
                    <TrashIcon className="relative w-6 h-6 text-red-400" />
                </div>
                <h2 className="text-base font-bold tracking-tight text-white mb-1.5">
                    {locale === "en" ? "Delete this photo?" : "この写真を削除しますか？"}
                </h2>
                <p className="text-white/45 text-[13px] mb-6 leading-relaxed">
                    {title
                        ? (locale === "en" ? `"${title}" will be removed. This can't be undone.` : `「${title}」を削除します。この操作は取り消せません。`)
                        : (locale === "en" ? "This can't be undone." : "この操作は取り消せません。")}
                </p>

                <div className="flex flex-col gap-2.5">
                    <button
                        onClick={onConfirm}
                        disabled={deleting}
                        className="w-full py-3 rounded-2xl bg-gradient-to-b from-[#ff4d4d] to-[#e5322f] text-white font-semibold text-[15px] shadow-lg shadow-red-900/40 ring-1 ring-inset ring-white/15 hover:brightness-110 active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center gap-1.5"
                        style={{ touchAction: "manipulation" }}
                    >
                        {deleting && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                        {deleting ? (locale === "en" ? "Deleting..." : "削除中...") : (locale === "en" ? "Delete" : "削除する")}
                    </button>
                    <button
                        ref={cancelRef}
                        onClick={onClose}
                        disabled={deleting}
                        className="w-full py-3 rounded-2xl text-white/60 hover:bg-white/[0.06] hover:text-white/80 active:scale-[0.98] transition text-[15px] font-medium disabled:opacity-50"
                        style={{ touchAction: "manipulation" }}
                    >
                        {locale === "en" ? "Cancel" : "キャンセル"}
                    </button>
                </div>
            </div>
        </div>
    );
}
