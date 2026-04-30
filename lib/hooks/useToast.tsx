// lib/hooks/useToast.tsx
// トースト通知機能用のカスタムフック

import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, ReactNode } from "react";

export type ToastType = "success" | "error" | "info";

export type Toast = {
    id: string;
    message: string;
    type: ToastType;
    duration?: number;
};

type ToastContextType = {
    toasts: Toast[];
    showToast: (message: string, type?: ToastType, duration?: number) => void;
    removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // アンマウント時に全タイマーをクリア
    useEffect(() => {
        return () => {
            timersRef.current.forEach(clearTimeout);
        };
    }, []);

    const showToast = useCallback((message: string, type: ToastType = "success", duration: number = 3000) => {
        const id = Math.random().toString(36).substring(2, 9);
        const newToast: Toast = { id, message, type, duration };

        setToasts((prev) => [...prev, newToast]);

        if (duration > 0) {
            const timer = setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id));
                timersRef.current.delete(id);
            }, duration);
            timersRef.current.set(id, timer);
        }
    }, []);

    // 手動クローズ時はタイマーもキャンセル
    const removeToast = useCallback((id: string) => {
        const timer = timersRef.current.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            timersRef.current.delete(id);
        }
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const value = useMemo(() => ({ toasts, showToast, removeToast }), [toasts, showToast, removeToast]);

    return (
        <ToastContext.Provider value={value}>
            {children}
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error("useToast must be used within a ToastProvider");
    }
    return context;
}
