"use client";

import React, { useState } from "react";
import Link from "next/link";
import { UserCircleIcon } from "@heroicons/react/24/outline";
import { ROUTES } from "@/lib/routes";

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

type Props = {
    userId: string;
    displayName: string;
    uploaderUsername?: string;
    /** "sm" = モーダル内など小さめ, "md" = 詳細ページ */
    size?: "sm" | "md";
    onClick?: (e: React.MouseEvent) => void;
};

export default function ProfileLink({ userId, displayName, uploaderUsername, size = "md", onClick }: Props) {
    const [avatarError, setAvatarError] = useState(false);
    const avatarUrl = CLOUDFRONT_URL ? `${CLOUDFRONT_URL}/profiles/${encodeURIComponent(userId)}` : "";
    const href = uploaderUsername ? ROUTES.USER_PROFILE(uploaderUsername) : `/users?id=${encodeURIComponent(userId)}`;

    const dim = size === "sm" ? "w-7 h-7" : "w-9 h-9";

    return (
        <Link
            href={href}
            onClick={onClick}
            className="inline-flex items-center gap-2.5 group"
            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
        >
            {/* アバター */}
            <div className={`${dim} rounded-full overflow-hidden bg-white/10 flex-shrink-0 ring-1 ring-white/20 group-hover:ring-white/50 transition-all`}>
                {avatarUrl && !avatarError ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={avatarUrl}
                        alt={displayName}
                        className="w-full h-full object-cover"
                        onError={() => setAvatarError(true)}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <UserCircleIcon className="w-4 h-4 text-white/40" />
                    </div>
                )}
            </div>
            {/* 名前 */}
            <span className="text-xs sm:text-sm text-white/60 group-hover:text-white/90 transition-colors">
                {displayName}
            </span>
        </Link>
    );
}
