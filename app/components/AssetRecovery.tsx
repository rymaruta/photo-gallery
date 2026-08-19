"use client";

import { useEffect } from "react";
import { isAssetElement, shouldAutoReload, markReloaded, stylesheetsApplied } from "../../lib/utils/assetRecovery";

// CSS/JS チャンクの読み込み失敗を検知したら1回だけ自動リロードする。
// （リソースの error はバブルしないため capture で拾う）
export default function AssetRecovery() {
    useEffect(() => {
        const reload = () => {
            if (!shouldAutoReload()) return;
            markReloaded();
            window.location.reload();
        };

        const onError = (e: Event) => {
            if (!isAssetElement(e.target)) return;
            reload();
        };
        window.addEventListener("error", onError, true);

        // error を取りこぼしても「CSS が当たっていない」状態は直接見て検知する
        const check = () => { if (!stylesheetsApplied(document)) reload(); };
        if (document.readyState === "complete") check();
        else window.addEventListener("load", check, { once: true });

        return () => {
            window.removeEventListener("error", onError, true);
            window.removeEventListener("load", check);
        };
    }, []);
    return null;
}
