"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { userFetch } from "../../lib/utils/api";
import { ROUTES } from "../../lib/routes";

/**
 * 表示名が未設定のログインユーザーに、名前を決めてもらうよう促す。
 *
 * 登録時はメールとパスワードしか受け取っていないため、名前を決めない限り
 * その人はユーザー検索に出てこず、他の人からは「名前未設定さん」と表示される。
 * 本人には気づきようがないので、こちらから伝える。
 */
export default function ProfileSetupBanner() {
    const { isAuthenticated } = useAuth();
    const { locale } = useLocale();
    const [needsName, setNeedsName] = useState(false);
    const isJa = locale !== "en";

    useEffect(() => {
        if (!isAuthenticated) return;
        let aborted = false;
        void (async () => {
            try {
                const res = await userFetch("/user/profile");
                if (!res.ok) return;
                const data = await res.json() as { displayName?: string };
                if (!aborted) setNeedsName(!data.displayName?.trim());
            } catch { /* 取得できないときは何も出さない */ }
        })();
        return () => { aborted = true; };
    }, [isAuthenticated]);

    if (!isAuthenticated || !needsName) return null;

    return (
        <div className="mx-4 mt-3 rounded-2xl bg-white/[0.07] ring-1 ring-white/10 px-4 py-3 flex items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-white/85 leading-snug">
                {isJa ? "名前を決めましょう" : "Pick a name"}
                <span className="block text-xs text-white/45 mt-0.5">
                    {isJa
                        ? "未設定だと「名前未設定さん」と表示され、検索でも見つけてもらえません。"
                        : "Without one you show up as “No name yet” and can’t be found in search."}
                </span>
            </p>
            <Link
                href={ROUTES.PROFILE_EDIT}
                className="flex-shrink-0 px-4 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 active:scale-[0.98] transition"
                style={{ touchAction: "manipulation" }}
            >
                {isJa ? "決める" : "Set"}
            </Link>
        </div>
    );
}
