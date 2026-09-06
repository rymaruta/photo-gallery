"use client";

import React from "react";
import Link from "next/link";
import { ROUTES } from "../../lib/routes";

/**
 * ログイン済みなのに投稿の権限が無い人に出す。
 *
 * 以前はここでログイン画面へ送り返していたが、`/login` はログイン済みだと
 * 元のページへ押し返すので**無限に往復**していた。直す手段は本人には
 * 無いので、せめて何が起きているかと、行き先を出す。
 */
export default function MemberOnlyNotice({ locale = "ja" }: { locale?: string }) {
    const en = locale === "en";
    return (
        <main className="p-6 min-h-screen text-white bg-black max-w-3xl mx-auto w-full flex items-center justify-center">
            <div className="text-center space-y-4">
                <p className="text-sm text-white/80">
                    {en
                        ? "This account can't post yet."
                        : "このアカウントにはまだ投稿の権限が付いていません。"}
                </p>
                <p className="text-xs text-white/50 leading-relaxed">
                    {en
                        ? "Sign-up sometimes doesn't finish setting up the account. Signing in again won't fix it — please get in touch and we'll set it up."
                        : "登録の最後の処理が完了しなかったときに起きます。ログインし直しても直りません。お手数ですが、ご連絡いただければこちらで設定します。"}
                </p>
                <Link href={ROUTES.HOME} className="inline-block text-sm text-white/80 underline hover:text-white">
                    {en ? "Back to gallery" : "ギャラリーに戻る"}
                </Link>
            </div>
        </main>
    );
}
