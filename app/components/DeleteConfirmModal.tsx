"use client";

import React, { useEffect, useRef } from "react";
import { ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import Image from "next/image";
import type { Photo } from "../data/photos";

type Props = {
    photo: Photo | null;
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    locale: "ja" | "en";
    deleting?: boolean;
};

export default function DeleteConfirmModal({
    photo,
    isOpen,
    onClose,
    onConfirm,
    locale,
    deleting = false,
}: Props) {
    const modalRef = useRef<HTMLDivElement>(null);
    const firstFocusableRef = useRef<HTMLButtonElement>(null);
    const lastFocusableRef = useRef<HTMLButtonElement>(null);

    // ESCキーで閉じる
    useEffect(() => {
        if (!isOpen) return;

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !deleting) {
                onClose();
            }
        };

        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, [isOpen, onClose, deleting]);

    // フォーカストラップ
    useEffect(() => {
        if (!isOpen) return;

        const handleTab = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;

            const focusableElements = modalRef.current?.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (!focusableElements || focusableElements.length === 0) return;

            const firstElement = focusableElements[0] as HTMLElement;
            const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

            if (e.shiftKey) {
                if (document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement.focus();
                }
            } else {
                if (document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        };

        document.addEventListener("keydown", handleTab);
        return () => document.removeEventListener("keydown", handleTab);
    }, [isOpen]);

    // モーダルが開いたときに最初のフォーカス可能要素にフォーカス
    useEffect(() => {
        if (isOpen && firstFocusableRef.current) {
            setTimeout(() => {
                firstFocusableRef.current?.focus();
            }, 100);
        }
    }, [isOpen]);

    if (!isOpen || !photo) return null;

    const getTitle = (photo: Photo): string => {
        const localizedTitle = typeof photo.title === "string"
            ? photo.title
            : photo.title?.[locale] || photo.title?.ja || photo.title?.en;

        if (localizedTitle && localizedTitle.trim() !== "") {
            return localizedTitle;
        }

        const parts = [];
        if (photo.location && photo.location.trim() !== "") {
            parts.push(photo.location);
        }
        if (photo.category && photo.category.trim() !== "") {
            parts.push(photo.category);
        }

        if (parts.length > 0) {
            return parts.join(" - ");
        }

        return photo.id || (locale === "en" ? "Untitled" : "無題");
    };

    const photoTitle = getTitle(photo);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
            aria-describedby="delete-modal-description"
        >
            {/* オーバーレイ */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onClick={deleting ? undefined : onClose}
                aria-hidden="true"
            />

            {/* モーダルコンテンツ */}
            <div
                ref={modalRef}
                className="relative bg-black border border-white/20 rounded-lg shadow-2xl max-w-md w-full overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* ヘッダー */}
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                            <ExclamationTriangleIcon className="w-6 h-6 text-red-400" />
                        </div>
                        <h2
                            id="delete-modal-title"
                            className="text-lg font-semibold text-white"
                        >
                            {locale === "en" ? "Delete Photo" : "写真を削除"}
                        </h2>
                    </div>
                    {!deleting && (
                        <button
                            onClick={onClose}
                            className="p-2 rounded-full hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30"
                            aria-label={locale === "en" ? "Close" : "閉じる"}
                        >
                            <XMarkIcon className="w-5 h-5 text-white/60" />
                        </button>
                    )}
                </div>

                {/* コンテンツ */}
                <div className="p-6 space-y-4">
                    {/* 写真プレビュー */}
                    <div className="relative w-full h-48 rounded-lg overflow-hidden bg-black border border-white/10">
                        <Image
                            src={photo.src}
                            alt={photoTitle}
                            fill
                            className="object-cover"
                            sizes="(max-width: 768px) 100vw, 400px"
                        />
                    </div>

                    {/* 警告メッセージ */}
                    <div className="space-y-2">
                        <p
                            id="delete-modal-description"
                            className="text-white/90 leading-relaxed"
                        >
                            {locale === "en" 
                                ? "Are you sure you want to delete this photo?"
                                : "この写真を削除してもよろしいですか？"}
                        </p>
                        <p className="text-sm text-white/60">
                            {locale === "en" 
                                ? `Photo: ${photoTitle}`
                                : `写真: ${photoTitle}`}
                        </p>
                    </div>
                </div>

                {/* フッター */}
                <div className="flex items-center justify-end gap-3 p-4 border-t border-white/10 bg-white/5">
                    <button
                        ref={firstFocusableRef}
                        onClick={onClose}
                        disabled={deleting}
                        className="px-4 py-2 text-sm font-medium text-white/80 bg-white/10 hover:bg-white/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-white/30"
                    >
                        {locale === "en" ? "Cancel" : "キャンセル"}
                    </button>
                    <button
                        ref={lastFocusableRef}
                        onClick={onConfirm}
                        disabled={deleting}
                        className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500/50 flex items-center gap-2"
                    >
                        {deleting ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                <span>{locale === "en" ? "Deleting..." : "削除中..."}</span>
                            </>
                        ) : (
                            <>
                                <ExclamationTriangleIcon className="w-4 h-4" />
                                <span>{locale === "en" ? "Delete" : "削除"}</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
