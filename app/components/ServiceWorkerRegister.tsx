"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
    useEffect(() => {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
        if (process.env.NODE_ENV !== "production") return;
        navigator.serviceWorker.register("/sw.js").catch((err) => {
            console.warn("[sw] register failed:", err);
        });
    }, []);
    return null;
}
