"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useLocale } from "../i18n/context";
import UserProfileClient from "./UserProfileClient";

// クエリパラメータ版のプロフィールページ（/users?id=<userId>）。
// ビルド時に存在するユーザーは静的生成された /users/<id>（OGP付き）が使われ、
// ビルド後に登録された新規ユーザーはこのページで表示される。
function UsersPageInner() {
    const { locale } = useLocale();
    const searchParams = useSearchParams();
    const userId = searchParams.get("id");

    if (!userId) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
                    <p className="text-white/60 text-sm">
                        {locale === "en" ? "No user ID specified." : "ユーザーIDが指定されていません。"}
                    </p>
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors text-sm"
                    >
                        <ArrowLeftIcon className="w-4 h-4" />
                        {locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}
                    </Link>
                </div>
            </main>
        );
    }

    return <UserProfileClient userId={userId} />;
}

export default function UsersPage() {
    return (
        <Suspense fallback={
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            </main>
        }>
            <UsersPageInner />
        </Suspense>
    );
}
