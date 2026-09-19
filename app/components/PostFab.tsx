"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { PlusIcon, PhotoIcon, BoltIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import { lockBodyScroll, unlockBodyScroll } from "../../lib/utils/scrollLock";
import { handOffStoryFile } from "../../lib/utils/storyHandoff";

/** `StoriesBar` の入力欄と同じ（受け付ける種類はあちらが決める） */
const STORY_ACCEPT = "image/*,video/mp4,video/webm,video/quicktime";

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
 * 画面右下に浮く「＋」。押すと「写真を投稿／ストーリーを投稿」の2択。
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
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const fabRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);

    useFocusTrap(open, panelRef, fabRef);
    useEscapeKey(open, () => setOpen(false));
    useEffect(() => {
        if (!open) return;
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, [open]);
    // 画面が変わったら閉じる（`HeaderNav` と同じ理由: ルートレイアウトなので再マウントされない）
    const [seenPath, setSeenPath] = useState(pathname);
    if (seenPath !== pathname) {
        setSeenPath(pathname);
        if (open) setOpen(false);
    }
    // クエリだけ変わる戻る・進む（`/users?id=A` → `?id=B`）はパスが同じなので上では
    // 拾えない。`HeaderNav` と同じく、開いている間だけ `popstate` を聞く
    useEffect(() => {
        if (!open) return;
        const close = () => setOpen(false);
        window.addEventListener("popstate", close);
        return () => window.removeEventListener("popstate", close);
    }, [open]);

    const canPost = isAuthenticated && (isAdminUser || isGeneralUser);
    const hiddenHere = HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"));
    if (!canPost || hiddenHere) return null;

    const isJa = locale !== "en";

    const goUpload = () => {
        setOpen(false);
        router.push(ROUTES.UPLOAD);
    };
    const onStoryFile = (f: File) => {
        setOpen(false);
        // バーが描かれていれば（トップ）その場で投稿の流れへ。無ければ預けてトップへ
        if (!handOffStoryFile(f)) router.push(ROUTES.HOME);
    };

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

            {open && createPortal(
                <div className="fixed inset-0 z-[60]" role="presentation">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden="true" data-testid="post-fab-backdrop" />
                    <div
                        ref={panelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label={isJa ? "投稿する" : "Create"}
                        className="absolute inset-x-3 bottom-0 max-w-md mx-auto rounded-t-2xl sm:rounded-2xl sm:bottom-6 ring-1 ring-white/10 shadow-2xl overflow-hidden story-media-in"
                        style={{ backgroundColor: "#16181c", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                    >
                        <p className="px-5 pt-4 pb-2 text-xs tracking-widest uppercase text-white/50 m-0">
                            {isJa ? "投稿する" : "Create"}
                        </p>
                        <ul className="m-0 p-0 divide-y divide-white/5" style={{ listStyle: "none" }}>
                            <li className="m-0 p-0">
                                <button type="button" onClick={goUpload}
                                        className="w-full flex items-center gap-4 px-5 py-4 text-left text-white hover:bg-white/10 transition-colors"
                                        style={{ touchAction: "manipulation", minHeight: "56px" }}>
                                    <PhotoIcon className="w-6 h-6 text-white/80" />
                                    <span>
                                        <span className="block text-base">{isJa ? "写真を投稿" : "Post a photo"}</span>
                                        <span className="block text-xs text-white/60">{isJa ? "作品として残る。公開すると個別ページができる" : "Stays as a work. Public photos get their own page."}</span>
                                    </span>
                                </button>
                            </li>
                            <li className="m-0 p-0">
                                <button type="button" onClick={() => fileRef.current?.click()}
                                        className="w-full flex items-center gap-4 px-5 py-4 text-left text-white hover:bg-white/10 transition-colors"
                                        style={{ touchAction: "manipulation", minHeight: "56px" }}>
                                    <BoltIcon className="w-6 h-6 text-white/80" />
                                    <span>
                                        <span className="block text-base">{isJa ? "ストーリーを投稿" : "Post a story"}</span>
                                        <span className="block text-xs text-white/60">{isJa ? "24時間で消える。写真か短い動画" : "Disappears in 24 hours. Photo or short video."}</span>
                                    </span>
                                </button>
                            </li>
                        </ul>
                        <div className="px-3 pb-3 pt-1">
                            <button type="button" onClick={() => setOpen(false)}
                                    className="w-full py-3 rounded-xl bg-white/5 text-white/70 hover:text-white hover:bg-white/10 text-sm transition-colors"
                                    style={{ touchAction: "manipulation" }}>
                                {isJa ? "閉じる" : "Close"}
                            </button>
                        </div>
                    </div>
                    {/* 選ぶのはここ（ユーザー操作の中でしか開けない）。中身は `StoriesBar` が確かめる。
                        **dialog の外に置く**——中に置くと `useFocusTrap` の「最後の要素」が
                        この見えない入力になり、Shift+Tab が行き止まり・Tab が外へ漏れる
                        （`FOCUSABLE` は `input` を含み、見えないかは見ない。レビューが指摘）。
                        `StoriesBar` も入力を下書きの dialog の外に置いている */}
                    <input
                        ref={fileRef}
                        type="file"
                        accept={STORY_ACCEPT}
                        className="hidden"
                        aria-label={isJa ? "ストーリーにする写真か動画を選ぶ" : "Choose a photo or video for your story"}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) onStoryFile(f);
                        }}
                    />
                </div>,
                document.body,
            )}
        </>
    );
}
