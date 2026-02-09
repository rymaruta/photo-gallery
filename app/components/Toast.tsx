// app/components/Toast.tsx
// トースト通知コンポーネント

"use client";

import React, { useEffect } from "react";
import { XMarkIcon, CheckCircleIcon, ExclamationCircleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { useToast, type Toast as ToastType } from "../../lib/hooks/useToast";

function ToastItem({ toast }: { toast: ToastType }) {
    const { removeToast } = useToast();
    const [isVisible, setIsVisible] = React.useState(false);
    const [isRemoving, setIsRemoving] = React.useState(false);
    const closeTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const t = setTimeout(() => setIsVisible(true), 10);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        return () => {
            if (closeTimeoutRef.current != null) clearTimeout(closeTimeoutRef.current);
        };
    }, []);

    const handleClose = () => {
        setIsRemoving(true);
        const t = setTimeout(() => removeToast(toast.id), 300);
        closeTimeoutRef.current = t;
    };

    const getIcon = () => {
        switch (toast.type) {
            case "success":
                return <CheckCircleIcon className="w-5 h-5 text-green-400" />;
            case "error":
                return <ExclamationCircleIcon className="w-5 h-5 text-red-400" />;
            case "info":
                return <InformationCircleIcon className="w-5 h-5 text-blue-400" />;
            default:
                return <InformationCircleIcon className="w-5 h-5 text-white/60" />;
        }
    };

    const getBgColor = () => {
        switch (toast.type) {
            case "success":
                return "bg-green-500/10 border-green-500/30";
            case "error":
                return "bg-red-500/10 border-red-500/30";
            case "info":
                return "bg-blue-500/10 border-blue-500/30";
            default:
                return "bg-white/10 border-white/20";
        }
    };

    return (
        <div
            className={`
                ${getBgColor()}
                border rounded-lg px-4 py-3 min-w-[280px] max-w-[400px]
                flex items-center gap-3 shadow-lg backdrop-blur-sm
                transition-all duration-300 ease-in-out
                ${isVisible && !isRemoving ? "opacity-100 translate-x-0" : "opacity-0 translate-x-full"}
            `}
            role="alert"
            aria-live="polite"
        >
            {getIcon()}
            <p className="flex-1 text-sm text-white/90">{toast.message}</p>
            <button
                onClick={handleClose}
                className="p-1 rounded-full hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30"
                aria-label="Close"
            >
                <XMarkIcon className="w-4 h-4 text-white/60 hover:text-white/90" />
            </button>
        </div>
    );
}

export default function ToastContainer() {
    const { toasts } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div
            className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
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
