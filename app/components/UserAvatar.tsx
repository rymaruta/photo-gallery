"use client";

import React, { useState } from "react";
import { UserCircleIcon } from "@heroicons/react/24/outline";
import { publicImageUrl } from "@/lib/utils/seo";

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

type Props = {
    userId: string;
    /** 外枠のサイズ・形状クラス（例: "w-10 h-10"）。rounded-full は内蔵 */
    className?: string;
    /** フォールバックアイコンのサイズクラス（例: "w-6 h-6"） */
    iconClassName?: string;
    /** CloudFront のキャッシュを避けたいときに付与するクエリ値 */
    cacheBust?: string | number;
};

// CloudFront 上のプロフィール画像を表示する共通アバター。
// 画像が未設定・読込失敗のときは人型アイコンにフォールバックする。
export default function UserAvatar({ userId, className = "w-10 h-10", iconClassName = "w-6 h-6", cacheBust }: Props) {
    const [error, setError] = useState(false);
    // userId が空なら組み立てない。**空を弾かないと `/profiles/` を取りに行く**
    // ——退会した人のコメント（CommentSection が userId="" で呼ぶ）1件につき
    // 403 が1本飛び、アイコンに落ちるまでちらつく。テストでは
    // NEXT_PUBLIC_CLOUDFRONT_URL が未設定なので url が空になり、見えない。
    const url = CLOUDFRONT_URL && userId
        ? publicImageUrl(`${CLOUDFRONT_URL}/profiles/${encodeURIComponent(userId)}${cacheBust !== undefined ? `?v=${cacheBust}` : ""}`)
        : "";

    return (
        <div className={`${className} rounded-full overflow-hidden bg-white/10 flex items-center justify-center flex-shrink-0`}>
            {url && !error ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={url}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={() => setError(true)}
                />
            ) : (
                <UserCircleIcon className={`${iconClassName} text-white/40`} />
            )}
        </div>
    );
}
