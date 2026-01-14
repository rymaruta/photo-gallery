// app/components/ToastProvider.tsx
// トーストプロバイダーのラッパーコンポーネント

"use client";

import { ToastProvider as Provider } from "../../lib/hooks/useToast";
import ToastContainer from "./Toast";

export default function ToastProvider({ children }: { children: React.ReactNode }) {
    return (
        <Provider>
            {children}
            <ToastContainer />
        </Provider>
    );
}
