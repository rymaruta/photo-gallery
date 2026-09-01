// app/components/Toast.tsx
// トースト通知コンポーネント

"use client";

import React, { useEffect, useRef } from "react";
import { XMarkIcon, CheckCircleIcon, ExclamationCircleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { useToast, type Toast as ToastType } from "../../lib/hooks/useToast";

function ToastItem({ toast }: { toast: ToastType }) {
    const { removeToast } = useToast();
    const [isVisible, setIsVisible] = React.useState(false);
    const [isRemoving, setIsRemoving] = React.useState(false);
    const removeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setIsVisible(true), 10);
        return () => clearTimeout(timer);
    }, []);

    // アンマウント時に削除タイマーをクリア
    useEffect(() => {
        return () => {
            if (removeTimerRef.current !== null) clearTimeout(removeTimerRef.current);
        };
    }, []);

    const handleClose = () => {
        setIsRemoving(true);
        removeTimerRef.current = setTimeout(() => {
            removeToast(toast.id);
        }, 300);
    };

    // アイコンを色付きの円バッジに包む（アプリ共通の質感）
    const getIcon = () => {
        switch (toast.type) {
            case "success":
                return <span className="w-7 h-7 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0"><CheckCircleIcon className="w-[18px] h-[18px] text-green-400" /></span>;
            case "error":
                return <span className="w-7 h-7 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0"><ExclamationCircleIcon className="w-[18px] h-[18px] text-red-400" /></span>;
            case "info":
                return <span className="w-7 h-7 rounded-full bg-sky-500/15 flex items-center justify-center flex-shrink-0"><InformationCircleIcon className="w-[18px] h-[18px] text-sky-400" /></span>;
            default:
                return <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0"><InformationCircleIcon className="w-[18px] h-[18px] text-white/60" /></span>;
        }
    };

    return (
        <div
            className={`
                bg-[#16181c]/90 ring-1 ring-white/10 rounded-2xl pl-2.5 pr-3 py-2.5 min-w-[280px] max-w-[400px]
                flex items-center gap-2.5 shadow-2xl backdrop-blur-md
                transition-all duration-300 ease-out
                ${isVisible && !isRemoving ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-3 scale-95"}
            `}
            role="alert"
            aria-live="polite"
        >
            {getIcon()}
            <p className="flex-1 text-sm text-white/90 leading-snug">{toast.message}</p>
            <button
                onClick={handleClose}
                className="p-1.5 rounded-full hover:bg-white/10 active:scale-90 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 flex-shrink-0"
                aria-label="通知を閉じる"
            >
                <XMarkIcon className="w-4 h-4 text-white/50 hover:text-white/90" />
            </button>
        </div>
    );
}

export default function ToastContainer() {
    const { toasts } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div
            className="fixed inset-x-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
            aria-live="assertive"
        >
            {toasts.map((toast) => (
                <div key={toast.id} className="pointer-events-auto">
                    <ToastItem toast={toast} />
                </div>
            ))}
        </div>
    );
}
