"use client";

import React, { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PlusIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import PostSheet from "./PostSheet";

/**
 * 「＋」を出さないページ。投稿・編集の画面（画面下に自分のバーがある）、
 * 管理、ログイン・登録、招待の着地。**接頭辞で見る**（`/user/edit?id=` など）
 */
const HIDDEN_PREFIXES = [
    ROUTES.UPLOAD,
    ROUTES.EDIT("x").split("?")[0],
    ROUTES.PROFILE_EDIT,
    ROUTES.DRAFTS,
    ROUTES.ADMIN,
    ROUTES.LOGIN,
    ROUTES.SIGNUP,
    "/j",
];

/**
 * 画面右下に浮く「＋」。押すと `PostSheet`（写真／ストーリーの2択）。
 *
 * owner:「画面の UI からどこに投稿する機能があるか分かりづらい」。入口が
 * マイページの「写真を追加」とトップのストーリー欄の「あなた ＋」に割れていて、
 * しかも種類が違う。**どの画面でも同じ位置に1つ**置く。
 *
 * **ヘッダーには置かない**——実測で、ログイン中のヘッダー（検索・通知・アバター・
 * メニュー）に 44px をもう1つ足すと、owner の端末幅（390px）でロゴが
 * 「Journey P…」に切れる（残り 108px ＜ 143px）。
 *
 * 出すのは**投稿できる人**（ログイン済みでグループあり＝`useMemberGate` が通す人）だけ。
 * 位置は画面下の他のもの（投稿バー `--bottom-bar-h`・ミニプレイヤー `--mini-player-h`）の
 * 上に逃がす。写真の拡大表示（z-50）とストーリー（z-95）の下に隠れる（z-40）。
 */
export default function PostFab() {
    const { isAuthenticated, isAdminUser, isGeneralUser } = useAuth();
    const { locale } = useLocale();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const fabRef = useRef<HTMLButtonElement | null>(null);
    const close = useCallback(() => setOpen(false), []);

    // 画面が変わったら閉じる（`HeaderNav` と同じ理由: ルートレイアウトなので再マウントされない）。
    // **これは常駐する側だけの仕事**——ページの中に置いた入口は遷移でまるごと外れる
    const [seenPath, setSeenPath] = useState(pathname);
    if (seenPath !== pathname) {
        setSeenPath(pathname);
        if (open) setOpen(false);
    }

    const canPost = isAuthenticated && (isAdminUser || isGeneralUser);
    const hiddenHere = HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"));
    if (!canPost || hiddenHere) return null;

    const isJa = locale !== "en";

    return (
        <>
            <button
                ref={fabRef}
                type="button"
                onClick={() => setOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={isJa ? "投稿する" : "Create"}
                title={isJa ? "投稿する" : "Create"}
                className="fixed right-4 z-40 w-14 h-14 rounded-full bg-white text-black shadow-lg shadow-black/50 flex items-center justify-center hover:bg-white/90 active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                style={{
                    bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px + var(--bottom-bar-h, 0px) + var(--mini-player-h, 0px))",
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                }}
            >
                <PlusIcon className="w-7 h-7" strokeWidth={2.5} />
            </button>

            {open && <PostSheet onClose={close} locale={locale} restoreRef={fabRef} />}
        </>
    );
}
