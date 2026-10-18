"use client";

import { useEffect, useRef } from "react";
import { isExpiredSignedUrl } from "../utils/signedImage";

/**
 * **期限の切れた署名つき画像が割れたら、一覧を取り直す**（2026-10-18 判断・札 #294）。
 *
 * 絞った写真の画像は期限つきの URL で届く（`lib/utils/signedImage.ts`）。期限が
 * 過ぎた URL は CloudFront が 403 で断るので、**取り直して新しい URL をもらうしか
 * 直す手が無い**。画面ごとに `onError` を配って回るのではなく、ページ全体の
 * 画像の失敗を1か所で拾う（`error` は泡立たないので、捕獲の段で聞く）。
 *
 * - 拾うのは**署名つきで期限を過ぎた URL の失敗だけ**（期限内の失敗は取り直しても直らない）
 * - 続けて割れても、取り直しは `minIntervalMs` に1回（1枚ごとに一覧を取り直さない）
 *
 * @param refetch 一覧を取り直す（自分の写真一覧・下書きなど、署名つき URL を出す画面）
 * @param enabled 署名つき URL を出しうる間だけ true（他人のプロフィールは署名しない）
 */
export function useSignedImageRefetch(
    refetch: () => void,
    enabled = true,
    { minIntervalMs = 15_000 }: { minIntervalMs?: number } = {},
): void {
    const latest = useRef(refetch);
    useEffect(() => {
        latest.current = refetch;
    }, [refetch]);
    const lastAt = useRef(Number.NEGATIVE_INFINITY);

    useEffect(() => {
        if (!enabled || typeof window === "undefined") return;
        const onError = (event: Event) => {
            const target = event.target;
            // `<picture>` の `<source>` が選ばれていても、失敗は `<img>` に届く（`currentSrc`）
            if (!(target instanceof HTMLImageElement)) return;
            const url = target.currentSrc || target.src;
            const now = Date.now();
            if (!url || !isExpiredSignedUrl(url, now)) return;
            if (now - lastAt.current < minIntervalMs) return;
            lastAt.current = now;
            latest.current();
        };
        window.addEventListener("error", onError, true);
        return () => window.removeEventListener("error", onError, true);
    }, [enabled, minIntervalMs]);
}
