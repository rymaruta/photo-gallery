"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
    useEffect(() => {
        // 水和が動いた証跡。<head> のハイドレーション・ウォッチドッグがこれを見て、
        // 付いていなければ（＝JS が動いていない）自己修復（SW解除+キャッシュ削除+再読込）する。
        try { document.documentElement.setAttribute("data-hydrated", "1"); } catch { /* ignore */ }

        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
        if (process.env.NODE_ENV !== "production") return;
        navigator.serviceWorker.register("/sw.js").catch((err) => {
            console.warn("[sw] register failed:", err);
        });
    }, []);
    return null;
}
