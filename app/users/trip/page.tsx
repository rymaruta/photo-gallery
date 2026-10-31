"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TripBookClient from "./TripBookClient";
import { LoadingState } from "@/app/components/StateViews";

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
                {/* 2026-10-30 束 0b C17: 回る輪ではなく iOS と同じ灰の骨組み */}
                <LoadingState className="min-h-[60vh]" />
            </main>
        }>
            <TripPageInner />
        </Suspense>
    );
}
