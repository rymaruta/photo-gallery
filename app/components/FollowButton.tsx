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

export default function FollowButton({ targetUserId, isOwner, isAuthenticated, locale }: Props) {
    const { isFollowing, followers, following, pending, toggle } = useFollow(targetUserId, isAuthenticated);
    const { showToast } = useToast();

    const onClick = async () => {
        const r = await toggle();
        if (r === "auth-required") showToast(locale === "en" ? "Log in to follow" : "フォローするにはログインしてください", "info");
        else if (r === "followed") showToast(locale === "en" ? "Following" : "フォローしました", "success");
        else if (r === "error") showToast(locale === "en" ? "Something went wrong" : "うまくいきませんでした", "error");
    };

    return (
        <div className="flex items-center gap-2 flex-wrap mb-4">
            {/* カウントピル（全員に表示） */}
            <div className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/10 px-3 py-1.5">
                <span className="text-sm font-bold tabular-nums leading-none">{followers.toLocaleString()}</span>
                <span className="text-[11px] text-white/60">{locale === "en" ? "followers" : "フォロワー"}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/10 px-3 py-1.5">
                <span className="text-sm font-bold tabular-nums leading-none">{following.toLocaleString()}</span>
                <span className="text-[11px] text-white/60">{locale === "en" ? "following" : "フォロー中"}</span>
            </div>

            {/* 他人のプロフィールにだけフォローボタン */}
            {!isOwner && (
                <button
                    onClick={() => void onClick()}
                    disabled={pending}
                    aria-pressed={isFollowing}
                    className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition active:scale-95 disabled:opacity-50 ${
                        isFollowing
                            ? "bg-white/10 ring-1 ring-white/15 text-white/80 hover:bg-white/15"
                            : "bg-white text-black hover:bg-white/90"
                    }`}
                    style={{ touchAction: "manipulation", minHeight: "36px" }}
                >
                    {isFollowing
                        ? <><CheckIcon className="w-4 h-4" />{locale === "en" ? "Following" : "フォロー中"}</>
                        : <><UserPlusIcon className="w-4 h-4" />{locale === "en" ? "Follow" : "フォロー"}</>}
                </button>
            )}
        </div>
    );
}
