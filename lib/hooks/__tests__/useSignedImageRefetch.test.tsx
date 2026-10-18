import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useSignedImageRefetch } from "../useSignedImageRefetch";
import { signedUrlExpiry, isExpiredSignedUrl } from "../../utils/signedImage";

/**
 * 2026-10-18（札 #294）: 絞った写真の画像は期限つき URL。期限を過ぎると CloudFront が
 * 403 で断るので、割れたら一覧を取り直して新しい URL をもらう。
 */
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const signed = (expiresSec: number) =>
    `https://cdn.example.com/private/u/p.jpg?Expires=${expiresSec}&Signature=abc~_-&Key-Pair-Id=K2`;
const past = signed(NOW / 1000 - 60);
const future = signed(NOW / 1000 + 600);

/** ページの中の画像が読み込みに失敗したことにする */
function failImage(src: string) {
    const img = document.createElement("img");
    img.src = src;
    document.body.appendChild(img);
    img.dispatchEvent(new Event("error"));   // 泡立たない（本物の画像の失敗と同じ）
    img.remove();
}

afterEach(() => vi.useRealTimers());

describe("署名つき URL の期限", () => {
    it("署名つきなら Expires を読み、署名の無い URL は null", () => {
        expect(signedUrlExpiry(signed(123))).toBe(123);
        expect(signedUrlExpiry("https://cdn.example.com/uploads/u/p.jpg")).toBeNull();
        expect(signedUrlExpiry("https://cdn.example.com/p.jpg?Expires=1")).toBeNull();
        expect(signedUrlExpiry("not a url")).toBeNull();
    });

    it("期限を過ぎた（30秒手前を含む）ものだけ「切れた」", () => {
        expect(isExpiredSignedUrl(past, NOW)).toBe(true);
        expect(isExpiredSignedUrl(signed(NOW / 1000 + 10), NOW)).toBe(true);
        expect(isExpiredSignedUrl(future, NOW)).toBe(false);
        expect(isExpiredSignedUrl("https://cdn.example.com/uploads/u/p.jpg", NOW)).toBe(false);
    });
});

describe("useSignedImageRefetch", () => {
    it("期限の切れた署名つき画像が割れたら、一覧を取り直す", () => {
        vi.useFakeTimers({ now: NOW });
        const refetch = vi.fn();
        renderHook(() => useSignedImageRefetch(refetch));
        failImage(past);
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("期限内の失敗・署名の無い画像の失敗では取り直さない（直らないので空回りする）", () => {
        vi.useFakeTimers({ now: NOW });
        const refetch = vi.fn();
        renderHook(() => useSignedImageRefetch(refetch));
        failImage(future);
        failImage("https://cdn.example.com/uploads/u/p.jpg");
        expect(refetch).not.toHaveBeenCalled();
    });

    it("続けて何枚割れても、間を置かずには取り直さない", () => {
        vi.useFakeTimers({ now: NOW });
        const refetch = vi.fn();
        renderHook(() => useSignedImageRefetch(refetch, true, { minIntervalMs: 15_000 }));
        failImage(past);
        failImage(past);
        expect(refetch).toHaveBeenCalledTimes(1);
        vi.setSystemTime(NOW + 16_000);
        failImage(past);
        expect(refetch).toHaveBeenCalledTimes(2);
    });

    it("使わない画面（enabled=false）・外したあとは聞かない", () => {
        vi.useFakeTimers({ now: NOW });
        const off = vi.fn();
        renderHook(() => useSignedImageRefetch(off, false));
        failImage(past);
        expect(off).not.toHaveBeenCalled();
        const gone = vi.fn();
        const { unmount } = renderHook(() => useSignedImageRefetch(gone));
        unmount();
        failImage(past);
        expect(gone).not.toHaveBeenCalled();
    });
});
