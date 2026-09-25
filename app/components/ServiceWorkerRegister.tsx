"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
    useEffect(() => {
        // 水和が動いた証跡。<head> のハイドレーション・ウォッチドッグがこれを見て、
        // 付いていなければ（＝JS が動いていない）自己修復（SW解除+キャッシュ削除+再読込）する。
        try { document.documentElement.setAttribute("data-hydrated", "1"); } catch { /* ignore */ }

        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
        if (process.env.NODE_ENV !== "production") return;
        let reg: ServiceWorkerRegistration | null = null;
        navigator.serviceWorker.register("/sw.js").then((r) => { reg = r; }).catch((err) => {
            console.warn("[sw] register failed:", err);
        });

        // **戻ってきたときに新しい sw.js を確かめる。** ホーム画面から起動した
        // アプリは、iOS が破棄せずに再開させることが多く、画面の移動も
        // クライアント側の遷移だけ——ブラウザが自分で更新を確かめる機会が
        // ほとんど無く、sw.js を直してもなかなか届かなかった（#17）。
        // 確かめるのは1時間に1回まで（sw.js は no-store なので毎回取りに行く）
        let lastCheck = Date.now();
        const onVisible = () => {
            if (document.visibilityState !== "visible" || !reg) return;
            if (Date.now() - lastCheck < 60 * 60 * 1000) return;
            lastCheck = Date.now();
            void reg.update().catch(() => { /* 圏外など。次の機会に */ });
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, []);
    return null;
}
