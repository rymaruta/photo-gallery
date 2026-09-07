"use client";

import { useEffect, useState } from "react";
import { XMarkIcon, ArrowUpOnSquareIcon } from "@heroicons/react/24/outline";
import { shouldShowIosInstallHint } from "@/lib/utils/pwa";
import { useLocale } from "../i18n/context";

const DISMISS_KEY = "jp_a2hs_dismissed";

/**
 * iOS Safari 向けの控えめな「ホーム画面に追加」ヒント。
 * iOS には自動インストールプロンプトが無いため、共有→ホーム画面に追加の導線を案内する。
 * 既にスタンドアロン起動中／一度×で閉じた場合は表示しない。
 */
export default function AddToHomeScreenHint() {
    const { locale } = useLocale();
    const [show, setShow] = useState(false);

    useEffect(() => {
        try {
            const standalone =
                (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
                window.matchMedia?.("(display-mode: standalone)").matches === true;
            const dismissed = localStorage.getItem(DISMISS_KEY) === "1";
            // マウント時に一度だけクライアント環境を判定して表示可否を決める（意図的な同期setState）
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setShow(shouldShowIosInstallHint({ userAgent: navigator.userAgent, standalone, dismissed }));
        } catch {
            // navigator/localStorage 不可の環境では出さない
        }
    }, []);

    if (!show) return null;

    const dismiss = () => {
        try {
            localStorage.setItem(DISMISS_KEY, "1");
        } catch {
            // 保存できなくても閉じるだけは行う
        }
        setShow(false);
    };

    return (
        <div className="mb-4 flex items-start gap-2 rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-3 text-xs text-white/70">
            <ArrowUpOnSquareIcon className="w-4 h-4 mt-0.5 text-sky-400 flex-shrink-0" />
            <p className="flex-1 leading-relaxed">
                {locale === "en"
                    ? "Tip: tap Share → “Add to Home Screen” to open this like an app (full-screen, one tap)."
                    : "ヒント: 共有 →「ホーム画面に追加」で、アプリのように全画面・1タップで開けます。"}
            </p>
            <button
                onClick={dismiss}
                aria-label={locale === "en" ? "Dismiss" : "閉じる"}
                className="-m-1 p-1 text-white/40 hover:text-white/70"
                style={{ touchAction: "manipulation" }}
            >
                <XMarkIcon className="w-4 h-4" />
            </button>
        </div>
    );
}
