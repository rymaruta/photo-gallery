"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TripBookClient from "./TripBookClient";

// 旅の一冊のクエリ版（/users/trip?id=<userId>&p=<写真の id>）。
// 一冊はその人の公開写真から画面でまとめるので、静的書き出しで建てるのはこの1枚だけ。
function TripPageInner() {
    const params = useSearchParams();
    const userId = params.get("id") ?? "";
    const photoId = params.get("p") ?? "";
    return <TripBookClient key={`${userId}|${photoId}`} userId={userId} photoId={photoId} />;
}

export default function TripPage() {
    return (
        <Suspense fallback={
            // 事前描画で焼かれるのはこの fallback（`/users` と同じ理由）
            <main className="min-h-screen text-white bg-bg">
                <h1 className="sr-only">旅の一冊</h1>
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            </main>
        }>
            <TripPageInner />
        </Suspense>
    );
}
