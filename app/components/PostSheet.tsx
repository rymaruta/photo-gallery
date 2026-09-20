"use client";

import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { PhotoIcon, ClockIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { ROUTES } from "../../lib/routes";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import { lockBodyScroll, unlockBodyScroll } from "../../lib/utils/scrollLock";
import { handOffStoryFile } from "../../lib/utils/storyHandoff";

/** `StoriesBar` の入力欄と同じ（受け付ける種類はあちらが決める） */
const STORY_ACCEPT = "image/*,video/mp4,video/webm,video/quicktime";

type Props = {
    onClose: () => void;
    locale: string;
    /** 閉じたときのフォーカスの戻り先＝開いたボタン */
    restoreRef: React.RefObject<HTMLElement | null>;
};

/**
 * 「写真を投稿／ストーリーを投稿」の2択。
 *
 * **開く場所は2つあるが、シートは1つ**——画面右下の「＋」（`PostFab`）と、
 * マイページの「投稿する」（`UserProfileClient`）。owner:「写真を追加のとこで
 * 投稿かストーリーを選べるようにしたい」。同じ2択を2か所に書くと、片方だけ
 * 直す日が来る（この台帳がいちばん多く記録している型）。
 *
 * **画面の中央に出す**（owner:「下じゃなくて真ん中の方が使いやすい」）。
 * 押せる面は1つ 88px 以上・文字は見出し 20px／本文 18px／説明 14px。
 * **寸法と字は px で固定する**——このサイトは 640px 未満で root を 14px に
 * 落とすので、rem の指定（`w-11`・`text-lg`）は端末で 38.5px・15.75px に縮む
 * （レビューが built CSS で計算）。意匠はこのサイトの地のもの（黒地・白の
 * ピル・細い白の線）だけで組む。**グラデーションは使わない**
 * （owner:「インスタの丸パクリみたいになってる」）。
 *
 * **画面が変わったときに閉じるのは呼ぶ側の仕事。** 常駐する `PostFab` は
 * パスを見比べて閉じる必要があるが、ページの中に置いた側は遷移で
 * まるごと外れるので要らない。ここで両方やると、要らない方に死んだ判定が残る。
 *
 * **開いている間だけマウントする**（`{open && <PostSheet …/>}`）。閉じている間も
 * 置くと、`useRouter` を常に呼ぶことになって**この部品を載せたページのテストが
 * 全部ルーターを模す羽目になる**（プロフィールの既存22件が実際に落ちた）。
 * 開く・閉じるは呼ぶ側が持つ。
 */
export default function PostSheet({ onClose, locale, restoreRef }: Props) {
    const router = useRouter();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);
    /** 開いたとき最初に当てる先＝主の操作（× に当てると読み上げが「閉じる」から始まる） */
    const primaryRef = useRef<HTMLButtonElement | null>(null);
    // **id は使い回さない。** 「＋」とマイページのボタンが同じページに居るので、
    // 固定の id にすると（両方が描かれた瞬間に）重複しうる
    const titleId = useId();

    useFocusTrap(true, panelRef, restoreRef, primaryRef);
    useEscapeKey(true, onClose);
    useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);
    // クエリだけ変わる戻る・進む（`/users?id=A` → `?id=B`）はパスが変わらないので、
    // 呼ぶ側のパス比較では拾えない。`HeaderNav` と同じく、開いている間だけ聞く
    useEffect(() => {
        window.addEventListener("popstate", onClose);
        return () => window.removeEventListener("popstate", onClose);
    }, [onClose]);

    const isJa = locale !== "en";

    const goUpload = () => {
        onClose();
        router.push(ROUTES.UPLOAD);
    };
    const onStoryFile = (f: File) => {
        onClose();
        // バーが描かれていれば（トップ）その場で投稿の流れへ。無ければ預けてトップへ
        if (!handOffStoryFile(f)) router.push(ROUTES.HOME);
    };

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-5" role="presentation">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" data-testid="post-sheet-backdrop" />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="relative w-full max-w-sm rounded-3xl bg-[#16181c]/95 backdrop-blur-md ring-1 ring-white/15 shadow-2xl shadow-black/60 overflow-hidden story-media-in"
                // 字: サイトの本文と同じ Inter → Noto Sans JP → system の並び（`layout.tsx`）。
                // 日本語はプロポーショナル詰め（`palt`）で、見出しはわずかに字間を開ける。
                // 太さはこのサイトが配っている 700 だけを使う（600 は Inter に無い）
                style={{ fontFeatureSettings: '"palt"' }}
            >
                <div className="flex items-center justify-between pl-5 pr-3 pt-3 pb-2 border-b border-white/10">
                    <h2 id={titleId} className="text-[20px] font-bold tracking-wide text-white m-0">{isJa ? "投稿する" : "Create"}</h2>
                    <button type="button" onClick={onClose}
                            aria-label={isJa ? "閉じる" : "Close"}
                            className="w-[44px] h-[44px] rounded-full text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
                            style={{ touchAction: "manipulation" }}>
                        <XMarkIcon className="w-[26px] h-[26px]" />
                    </button>
                </div>
                <div className="px-4 pb-5 pt-4 flex flex-col gap-[12px]">
                    <button ref={primaryRef} type="button" onClick={goUpload}
                            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-left transition-colors active:scale-[0.98]"
                            style={{ touchAction: "manipulation", minHeight: "88px", WebkitTapHighlightColor: "transparent" }}>
                        <span className="w-[56px] h-[56px] rounded-2xl bg-white text-black flex items-center justify-center flex-shrink-0 shadow-lg shadow-black/40">
                            <PhotoIcon className="w-[28px] h-[28px]" />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-[18px] font-bold tracking-wide text-white leading-snug">{isJa ? "写真を投稿" : "Post a photo"}</span>
                            <span className="block text-[14px] text-white/70 mt-1 leading-relaxed">{isJa ? "ずっと残る1枚。公開すると個別ページができる" : "Stays for good. Public photos get their own page."}</span>
                        </span>
                    </button>
                    <button type="button" onClick={() => fileRef.current?.click()}
                            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-left transition-colors active:scale-[0.98]"
                            style={{ touchAction: "manipulation", minHeight: "88px", WebkitTapHighlightColor: "transparent" }}>
                        {/* 白の線の丸＝「消える」側。写真の白い四角と対にする */}
                        <span className="w-[56px] h-[56px] rounded-full ring-2 ring-white/80 ring-inset flex items-center justify-center flex-shrink-0">
                            <ClockIcon className="w-[28px] h-[28px] text-white" />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-[18px] font-bold tracking-wide text-white leading-snug">{isJa ? "ストーリーを投稿" : "Post a story"}</span>
                            <span className="block text-[14px] text-white/70 mt-1 leading-relaxed">{isJa ? "24時間で消える。写真か短い動画" : "Disappears in 24 hours. Photo or short video."}</span>
                        </span>
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
    );
}
