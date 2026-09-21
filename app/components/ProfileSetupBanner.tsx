"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
    const { isAuthenticated, userId } = useAuth();
    const { locale } = useLocale();
    const pathname = usePathname();
    // **誰についての判定かを state に含める。** 真偽値（hasNameRef +
    // needsName）で持っていた頃はレイアウト常駐のままアカウントをまたぎ、
    // 名前ありAのあとに名前なしBがログインすると B のバナーが恒久に出ず、
    // 逆順では A の判定で B に誤表示していた（B-2 で自分が入れた回帰）。
    // userId が合致するときだけ表示に使うので、切替時のリセットは要らない。
    const [nameState, setNameState] = useState<{ userId: string; needsName: boolean } | null>(null);
    // 「設定済み」と確認できた userId（遷移ごとの API を増やさないため）
    const verifiedUserRef = useRef<string | null>(null);
    const isJa = locale !== "en";

    // **遷移のたびに確かめ直す（未設定と分かっている間だけ）。**
    // 取得が `[isAuthenticated]` の1回きりだった頃は、このバナーが
    // レイアウトに常駐していて再マウントされないため、
    // 「決める」→ プロフィールで名前を保存 → 戻ってくる、と操作しても
    // **バナーが「名前を決めましょう」のまま残った**（ハードリロードまで消えない）。
    // 名前を持つ人は最初の1回で verifiedUserRef が立ち、以後は何も撃たない。
    useEffect(() => {
        // ログアウト中は何もしない（表示は下の render ガードが消す。
        // 残った nameState も userId 不一致で使われない）
        if (!isAuthenticated || !userId) return;
        if (verifiedUserRef.current === userId) return;
        let aborted = false;
        void (async () => {
            try {
                const res = await userFetch("/user/profile");
                if (!res.ok) return;
                const data = await res.json() as { displayName?: string };
                const hasName = !!data.displayName?.trim();
                if (!aborted) {
                    if (hasName) verifiedUserRef.current = userId;
                    setNameState({ userId, needsName: !hasName });
                }
            } catch { /* 取得できないときは何も出さない */ }
        })();
        return () => { aborted = true; };
    }, [isAuthenticated, userId, pathname]);

    const needsName = !!userId && nameState?.userId === userId && nameState.needsName;
    if (!isAuthenticated || !needsName) return null;

    return (
        <div className="mx-4 mt-3 rounded-2xl bg-white/[0.07] ring-1 ring-white/10 px-4 py-3 flex items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-white/85 leading-snug">
                {isJa ? "名前を決めましょう" : "Pick a name"}
                <span className="block text-xs text-white/50 mt-0.5">
                    {isJa
                        ? "未設定だと「名前未設定さん」と表示され、検索でも見つけてもらえません。"
                        : "Without one you show up as “No name yet” and can’t be found in search."}
                </span>
            </p>
            <Link
                href={ROUTES.PROFILE_EDIT}
                className="flex-shrink-0 px-4 py-2 rounded-full bg-accent-fill text-white text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition"
                style={{ touchAction: "manipulation" }}
            >
                {isJa ? "決める" : "Set"}
            </Link>
        </div>
    );
}
