"use client";

import React from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import UserAvatar from "./UserAvatar";

type Props = {
    userId: string;
    displayName: string;
    /** @deprecated /users ページは userId で解決するため使用しない */
    uploaderUsername?: string;
    /** "sm" = モーダル内など小さめ, "md" = 詳細ページ */
    size?: "sm" | "md";
    onClick?: (e: React.MouseEvent) => void;
};

export default function ProfileLink({ userId, displayName, size = "md", onClick }: Props) {
    const href = ROUTES.USER_PROFILE(userId);

    const dim = size === "sm" ? "w-7 h-7" : "w-9 h-9";

    return (
        <Link
            href={href}
            onClick={onClick}
            className="inline-flex items-center gap-2.5 group"
            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
        >
            {/* アバター */}
            <div className="rounded-full ring-1 ring-white/20 group-hover:ring-white/50 transition-all flex-shrink-0">
                <UserAvatar userId={userId} className={dim} iconClassName="w-4 h-4" />
            </div>
            {/* 名前 */}
            <span className="text-xs sm:text-sm text-white/60 group-hover:text-white/90 transition-colors">
                {displayName}
            </span>
        </Link>
    );
}
