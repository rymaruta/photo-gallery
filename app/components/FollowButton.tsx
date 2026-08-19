"use client";

// プロフィールのフォローUI: フォロワー/フォロー中の数（全員に表示）と、
// 他人のプロフィールにはフォローボタン。

import React from "react";
import { UserPlusIcon, CheckIcon } from "@heroicons/react/24/outline";
import { useFollow } from "../../lib/hooks/useFollow";
import { useToast } from "../../lib/hooks/useToast";

type Props = {
    targetUserId: string;
    isOwner: boolean;
    isAuthenticated: boolean;
    locale: "ja" | "en";
};

export default function FollowButton({ targetUserId, isAuthenticated, locale }: Omit<Props, "isOwner"> & { isOwner?: boolean }) {
    const { followers, following } = useFollow(targetUserId, isAuthenticated);


    // 統計ピル（投稿・いいね）と同じ行に並べられるよう、ラッパーを持たない
    // フラグメントで返す。並びと余白は親のフレックス行が決める。
    return (
        <>
            {/* カウントピル（全員に表示） */}
            <div className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/10 px-3 py-1.5">
                <span className="text-sm font-bold tabular-nums leading-none">{followers.toLocaleString()}</span>
                <span className="text-[11px] text-white/60">{locale === "en" ? "followers" : "フォロワー"}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/10 px-3 py-1.5">
                <span className="text-sm font-bold tabular-nums leading-none">{following.toLocaleString()}</span>
                <span className="text-[11px] text-white/60">{locale === "en" ? "following" : "フォロー中"}</span>
            </div>

        </>
    );
}

/**
 * フォローボタン単体。数字のピル（FollowButton）とは切り離し、
 * プロフィールのアクション行（編集/写真を追加 と同じ場所）に置けるようにする。
 */
export function FollowAction({ targetUserId, isOwner, isAuthenticated, locale }: Props) {
    const { isFollowing, pending, toggle } = useFollow(targetUserId, isAuthenticated);
    const { showToast } = useToast();

    if (isOwner) return null;

    const onClick = async () => {
        const r = await toggle();
        if (r === "auth-required") showToast(locale === "en" ? "Log in to follow" : "フォローするにはログインしてください", "info");
        else if (r === "followed") showToast(locale === "en" ? "Following" : "フォローしました", "success");
        else if (r === "error") showToast(locale === "en" ? "Something went wrong" : "うまくいきませんでした", "error");
    };

    return (
        <button
            onClick={() => void onClick()}
            disabled={pending}
            aria-pressed={isFollowing}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50 ${
                isFollowing
                    ? "bg-black/30 backdrop-blur-md ring-1 ring-white/15 text-white/85 hover:bg-black/40"
                    : "bg-white text-black hover:bg-white/90"
            }`}
            style={{ touchAction: "manipulation", minHeight: "44px" }}
        >
            {isFollowing
                ? <><CheckIcon className="w-4 h-4" />{locale === "en" ? "Following" : "フォロー中"}</>
                : <><UserPlusIcon className="w-4 h-4" />{locale === "en" ? "Follow" : "フォロー"}</>}
        </button>
    );
}
