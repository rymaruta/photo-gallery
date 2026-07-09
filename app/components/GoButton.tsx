"use client";

import React from "react";
import { PaperAirplaneIcon } from "@heroicons/react/24/solid";
import { PaperAirplaneIcon as PaperAirplaneIconOutline } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { useGoTo } from "../../lib/hooks/useGoTo";
import { useToast } from "../../lib/hooks/useToast";
import { hapticTap } from "../../lib/utils/haptics";
import type { Locale } from "@/lib/data/photos";

// 「行く」ボタン（コンパクト版）。ギャラリーモーダル等に置く。
// 押すと行きたいリストに入り、実際にその場所で投稿すると撮影者に通知が届く。
export default function GoButton({ photoId, locale }: { photoId: string; locale: Locale }) {
    const { isAuthenticated } = useAuth();
    const { going, goCount, pending, toggle } = useGoTo(photoId, isAuthenticated);
    const { showToast } = useToast();

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        void (async () => {
            hapticTap();
            const r = await toggle();
            if (r === "auth-required") {
                showToast(locale === "en" ? "Log in to save places you want to visit" : "ログインすると「行く」で行きたいリストに保存できます", "info");
            } else if (r === "added") {
                showToast(locale === "en" ? "Added to your travel list 🧭" : "行きたいリストに追加しました 🧭", "success");
            }
        })();
    };

    return (
        <button
            onClick={handleClick}
            onTouchStart={(e) => e.stopPropagation()}
            disabled={pending}
            aria-pressed={going}
            aria-label={going
                ? (locale === "en" ? "Remove from travel list" : "行きたいを取り消す")
                : (locale === "en" ? "I'll go here" : "この場所に行く")}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-full transition disabled:opacity-60 active:scale-[0.98] ${going ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/40" : "bg-white/10 hover:bg-white/20 text-white"}`}
            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", minHeight: "44px" }}
        >
            {going
                ? <PaperAirplaneIcon className="w-4 h-4 -rotate-45 text-sky-400" />
                : <PaperAirplaneIconOutline className="w-4 h-4 -rotate-45" />}
            <span>{going ? (locale === "en" ? "Going!" : "行く！") : (locale === "en" ? "I'll go" : "行く")}</span>
            {goCount > 0 && <span className="text-xs text-white/60 tabular-nums">{goCount}</span>}
        </button>
    );
}
