"use client";

import { useEffect } from "react";
import { isAssetElement, shouldAutoReload, markReloaded } from "../../lib/utils/assetRecovery";

// CSS/JS チャンクの読み込み失敗を検知したら1回だけ自動リロードする。
// （リソースの error はバブルしないため capture で拾う）
export default function AssetRecovery() {
    useEffect(() => {
        const onError = (e: Event) => {
            if (!isAssetElement(e.target)) return;
            if (!shouldAutoReload()) return;
            markReloaded();
            window.location.reload();
        };
        window.addEventListener("error", onError, true);
        return () => window.removeEventListener("error", onError, true);
    }, []);
    return null;
}
