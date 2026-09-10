"use client";

import React from "react";
import Link from "next/link";
import { ROUTES } from "../../lib/routes";
import { siteConfig } from "../../lib/utils/seo";

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
                {/* **「ご連絡ください」と書いておきながら連絡先が無かった。**
                    この画面に落ちた人はアップロード・下書き・編集・アルバムが
                    全部開けず、直す手段は連絡しかないのに、出口は
                    「ギャラリーに戻る」だけだった。宛先が設定されていない
                    ときは、載っている場所（プライバシーポリシー）へ送る */}
                <div className="flex flex-col items-center gap-3">
                    {siteConfig.contactEmail ? (
                        <a
                            href={`mailto:${siteConfig.contactEmail}`}
                            className="inline-block text-sm text-white/80 underline hover:text-white"
                        >
                            {en ? "Contact us" : "問い合わせる"}
                        </a>
                    ) : (
                        <Link href={ROUTES.PRIVACY} className="inline-block text-sm text-white/80 underline hover:text-white">
                            {en ? "Contact details" : "問い合わせ先を見る"}
                        </Link>
                    )}
                    <Link href={ROUTES.HOME} className="inline-block text-sm text-white/60 underline hover:text-white">
                        {en ? "Back to gallery" : "ギャラリーに戻る"}
                    </Link>
                </div>
            </div>
        </main>
    );
}
