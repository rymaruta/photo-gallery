"use client";
import React from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import { HeartIcon, BookmarkIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartIconOutline, BookmarkIcon as BookmarkIconOutline } from "@heroicons/react/24/outline";

// **操作ラベルは日本語。** ここだけ英語のままだったので、支援技術が
// 「Previous ボタン」「Next ボタン」と読み上げ、同じ画面の共有ボタン
// （日本語化済み）と混ざっていた。言語の切り替えは `6d72bfb` で
// 削除済みで、このアプリは日本語だけを出す。

const BTN_BASE =
    "absolute rounded-full bg-black/30 ring-1 ring-white/10 hover:bg-black/50 active:scale-95 " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 shadow-lg transition z-20";

const BTN_STYLE: React.CSSProperties = {
    backdropFilter: "blur(8px)",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
    minWidth: "44px",
    minHeight: "44px",
    padding: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "auto",
};

type Props = {
    onPrev: () => void;
    onNext: () => void;
    onClose: () => void;
    isFav: boolean;
    onToggleFavorite: () => void;
    isSaved: boolean;
    onToggleSave: () => void;
    /** 保存の往復中／ログイン状態の確認中。押しても何も起きない期間 */
    savePending?: boolean;
    firstFocusableRef: React.RefObject<HTMLButtonElement | null>;
};

export default function ModalControls({
    onPrev, onNext, onClose, isFav, onToggleFavorite,
    isSaved, onToggleSave, savePending = false,
    firstFocusableRef,
}: Props) {
    const stopAndCall = (fn: () => void) => ({
        onClick: (e: React.MouseEvent) => { e.stopPropagation(); fn(); },
    });

    return (
        <>
            {/* 前へ */}
            <button
                ref={firstFocusableRef}
                {...stopAndCall(onPrev)}
                aria-label="前の写真"
                className={`${BTN_BASE} left-2 sm:left-3 top-1/2 transform -translate-y-1/2`}
                style={BTN_STYLE}
            >
                <ArrowLeftIcon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </button>

            {/* 次へ */}
            <button
                {...stopAndCall(onNext)}
                aria-label="次の写真"
                className={`${BTN_BASE} right-2 sm:right-3 top-1/2 transform -translate-y-1/2`}
                style={BTN_STYLE}
            >
                <ArrowRightIcon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </button>

            {/* いいね（閉じるボタンは right-2 + 幅44px ≈ 52px を占有するため、重ならないよう 64px 以上離す）

                **読み上げる名前は「いいね」に揃える。** 同じハートを、
                ここだけ「お気に入り」と呼んでいた——写真ページのボタンは
                「いいね」、集まる先のページは「いいねした写真」なので、
                音声操作の人には**別の機能に見える**（`b74da05e` と同じ型）。
                見た目は1pxも変えていない（アイコンだけのボタン）。 */}
            <button
                {...stopAndCall(onToggleFavorite)}
                aria-label={isFav ? "いいねを取り消す" : "いいね"}
                className={`${BTN_BASE} top-2 sm:top-3 right-[64px] sm:right-[72px]`}
                style={BTN_STYLE}
            >
                {isFav
                    ? <HeartIcon className="w-5 h-5 sm:w-6 sm:h-6 text-red-500" />
                    : <HeartIconOutline className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                }
            </button>

            {/* 保存（ブックマーク）。**いいねとは別物**——いいねは投稿者に届く
                公開の反応で、保存はあとで見返すための自分だけの棚
                （`/saves` に集まる。`/favorites` とは別のページ）。

                横の位置は 44px の当たりが重ならないように取る:
                閉じる 8..52px → いいね 64..108px → 保存 120..164px
                （sm では 12..56 / 72..116 / 132..176）。
                **px で書く**——640px 未満で root が 14px に落ちるので、
                rem で書くと縮んで隣と重なる。

                **`aria-pressed` は付けない。** 読み上げ名が「保存を取り消す」
                （＝これから起きること）なので、足すと「保存を取り消す、
                押されています」と読まれて意味が逆に取れる。
                隣のいいねも同じ形（操作を名前にして `aria-pressed` 無し）で、
                状態を名前にしている `FollowButton` とは流儀が違う。

                **`pending` の間は `aria-busy` だけ付けて、`disabled` にはしない。**
                共有リンクを開いた直後はログイン状態の確認中で、押しても
                `toggle` が入口で抜ける（アイコンも変わらずトーストも出ない）
                ので、読み上げには「処理中」と伝える。ただし `disabled` に
                すると、Enter で押した人のフォーカスが往復中に body へ落ち、
                応答後も戻らない（`useFocusTrap` が次の Tab で先頭へ引き戻す）。
                隣のいいねも `busyRef` だけで連打を弾いて `disabled` にして
                いないので、それに揃える。連打は `usePhotoSave` の `busyRef` が
                既に止めている。 */}
            <button
                {...stopAndCall(onToggleSave)}
                aria-label={isSaved ? "保存を取り消す" : "保存"}
                aria-busy={savePending}
                className={`${BTN_BASE} top-2 sm:top-3 right-[120px] sm:right-[132px]`}
                style={BTN_STYLE}
            >
                {isSaved
                    ? <BookmarkIcon className="w-5 h-5 sm:w-6 sm:h-6 text-sky-400" />
                    : <BookmarkIconOutline className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                }
            </button>

            {/* 閉じる */}
            <button
                {...stopAndCall(onClose)}
                aria-label="閉じる"
                className={`${BTN_BASE} top-2 sm:top-3 right-2 sm:right-3`}
                style={BTN_STYLE}
            >
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </>
    );
}
