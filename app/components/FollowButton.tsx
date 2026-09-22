"use client";

// プロフィールのフォローUI: フォロワー/フォロー中の数（全員に表示）と、
// 他人のプロフィールにはフォローボタン。

import React, { useRef, useState } from "react";
import { UserPlusIcon, CheckIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useFollow } from "../../lib/hooks/useFollow";
import { useToast } from "../../lib/hooks/useToast";
import FollowingSheet, { type FollowListKind } from "./FollowingSheet";

type Props = {
    targetUserId: string;
    isOwner: boolean;
    isAuthenticated: boolean;
    locale: "ja" | "en";
};

export default function FollowButton({ targetUserId, isAuthenticated, locale }: Omit<Props, "isOwner"> & { isOwner?: boolean }) {
    const { followers, following, countsKnown } = useFollow(targetUserId, isAuthenticated);
    const [sheet, setSheet] = useState<FollowListKind | null>(null);
    const followingBtnRef = useRef<HTMLButtonElement>(null);
    const followersBtnRef = useRef<HTMLButtonElement>(null);


    // **自分の行を持つ。** 以前は「投稿・いいね」と同じ行に並べるために
    // ラッパー無しのフラグメントを返していたが、フォロー中／フォロワーは
    // 次の行に置く（owner の指示）。
    //
    // **行ごと消さない。** `countsKnown` は毎回 false から始まるので、
    // 行ごと消すと**初回描画には必ず無く**、数が届いた瞬間に約33pxの行が
    // 挿入されて自己紹介より下（サイト・タブ・写真グリッド）が全部動く。
    // すぐ上の「投稿・いいね」は同じ問題に `photosResolved ? postCount : "…"`
    // で答えている。**数字だけ `…` にすれば**「0人と言い切らない」を守った
    // まま行の高さが動かない。
    const shown = (n: number) => (countsKnown ? n.toLocaleString() : "…");

    return (
        <div className="flex flex-wrap items-center gap-2 -mt-2 mb-4">
            {/* カウントピル（全員に表示）。フォロー中 → フォロワー の順。
                **まだ分からない間は数を出さない**——`?? EMPTY` の 0/0 を
                そのまま描いていた頃は、取得が落ちた人が「フォロワー 0」と
                言い切られていた（本当に0人の人と区別が付かない）。 */}
            {/* 0人のときと、数が届く前は押させない（開いても空／押せる・
                押せないが途中で変わる）。未ログインは一覧の口が断る */}
            {isAuthenticated && countsKnown && following > 0 ? (
                <button
                    type="button"
                    ref={followingBtnRef}
                    onClick={() => setSheet("following")}
                    aria-haspopup="dialog"
                    className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/10 px-3 py-1.5 hover:bg-black/50 active:scale-95 transition"
                    style={{ touchAction: "manipulation" }}
                >
                    <span className="text-sm font-bold tabular-nums leading-none">{shown(following)}</span>
                    <span className="text-[11px] text-white/60">{locale === "en" ? "following" : "フォロー中"}</span>
                    {/* **押せると分かるようにする。** 押せない側のピルと
                        `hover:` しか違わないと、スマホでは見分けが付かない */}
                    <ChevronRightIcon className="w-3 h-3 text-white/60" aria-hidden="true" />
                </button>
            ) : (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/10 px-3 py-1.5">
                    <span className="text-sm font-bold tabular-nums leading-none">{shown(following)}</span>
                    <span className="text-[11px] text-white/60">{locale === "en" ? "following" : "フォロー中"}</span>
                </div>
            )}
            {isAuthenticated && countsKnown && followers > 0 ? (
                <button
                    type="button"
                    ref={followersBtnRef}
                    onClick={() => setSheet("followers")}
                    aria-haspopup="dialog"
                    className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/10 px-3 py-1.5 hover:bg-black/50 active:scale-95 transition"
                    style={{ touchAction: "manipulation" }}
                >
                    <span className="text-sm font-bold tabular-nums leading-none">{shown(followers)}</span>
                    <span className="text-[11px] text-white/60">{locale === "en" ? "followers" : "フォロワー"}</span>
                    <ChevronRightIcon className="w-3 h-3 text-white/60" aria-hidden="true" />
                </button>
            ) : (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/10 px-3 py-1.5">
                    <span className="text-sm font-bold tabular-nums leading-none">{shown(followers)}</span>
                    <span className="text-[11px] text-white/60">{locale === "en" ? "followers" : "フォロワー"}</span>
                </div>
            )}
            {sheet && (
                <FollowingSheet
                    userId={targetUserId}
                    kind={sheet}
                    locale={locale}
                    openerRef={sheet === "following" ? followingBtnRef : followersBtnRef}
                    onClose={() => setSheet(null)}
                />
            )}
        </div>
    );
}

/**
 * フォローボタン単体。数字のピル（FollowButton）とは切り離し、
 * プロフィールのアクション行（編集/写真を追加 と同じ場所）に置けるようにする。
 */
/**
 * @param variant "outline" は最終版モックの写真ページ用（青の枠線・塗らない・伸びない）。
 *   既定の "filled" はプロフィール（塗り・行いっぱい）のまま
 */
export function FollowAction({ targetUserId, isOwner, isAuthenticated, locale, variant = "filled" }: Props & { variant?: "filled" | "outline" }) {
    // 数は描かないので取りに行かない（検索結果 N 件で N 本飛んでいた）。
    // 数のピルはプロフィールの FollowButton が別に取る。
    const { isFollowing, pending, resolved, toggle } = useFollow(targetUserId, isAuthenticated, false);
    const { showToast } = useToast();

    if (isOwner) return null;

    const onClick = async () => {
        const { result, message } = await toggle();
        if (result === "auth-required") {
            showToast(message ?? (locale === "en" ? "Log in to follow" : "フォローするにはログインしてください"), "info");
        } else if (result === "followed") {
            showToast(locale === "en" ? "Following" : "フォローしました", "success");
        } else if (result === "error") {
            // サーバーの理由をそのまま出す（「自分はフォローできません」など）。
            // 一語に潰していた頃は、直せるものも直せない案内になっていた
            showToast(message ?? (locale === "en" ? "Something went wrong" : "うまくいきませんでした"), "error");
        }
    };

    return (
        <button
            onClick={() => void onClick()}
            // 判定が終わるまで押させない。初期値の false を「未フォロー」と
            // 同じ扱いにしていた頃は、一覧を取り終える前にボタンが「フォロー」と
            // 出て、押しても既にフォロー済みで画面が変わらなかった。
            disabled={pending || !resolved}
            aria-pressed={isFollowing}
            className={`${variant === "outline" ? "flex-shrink-0 px-4 py-2" : "flex-1 px-4 py-2.5"} inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50 ${
                isFollowing
                    ? "bg-black/30 backdrop-blur-md ring-1 ring-white/15 text-white/85 hover:bg-black/40"
                    : variant === "outline"
                        ? "bg-transparent ring-1 ring-accent text-accent hover:bg-accent/10"
                        : "bg-accent-fill text-white hover:brightness-110"
            }`}
            style={{ touchAction: "manipulation", minHeight: variant === "outline" ? "36px" : "44px" }}
        >
            {isFollowing
                ? <><CheckIcon className="w-4 h-4" />{locale === "en" ? "Following" : "フォロー中"}</>
                : <><UserPlusIcon className="w-4 h-4" />{locale === "en" ? "Follow" : "フォロー"}</>}
        </button>
    );
}
