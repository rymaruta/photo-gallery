import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ja } from "../i18n/labels";

/**
 * **ホームの「新着」は投稿日の新しい順**（2026-10-30・owner の質問
 * 「iOS から投稿したら Web 側に反映されないの？」）。
 *
 * 並べ方そのものは `lib/hooks/__tests__/useGallery.test.ts` が見る。ここは
 * **画面が `postedOrderOnNew` を渡しているか**（配線）だけを見る——フックだけ
 * 見ていると、ホームが渡し忘れても素通りする。
 */
vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { ...ja, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../components/GalleryGrid", () => ({ default: () => null }));

const PHOTOS = [
    { id: "recent-shot", src: "https://cdn/a.jpg", title: "あ", category: "landscape", tags: [], date: "2026-10-29", createdAt: "2026-10-29T12:00:00Z" },
    // 2019年に撮って、今日投稿した写真
    { id: "old-shot-new-post", src: "https://cdn/b.jpg", title: "い", category: "landscape", tags: [], date: "2019-05-01", createdAt: "2026-10-30T09:00:00Z" },
    { id: "mid", src: "https://cdn/c.jpg", title: "う", category: "landscape", tags: [], date: "2026-10-20", createdAt: "2026-10-21T00:00:00Z" },
];
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: PHOTOS, loaded: true }) }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(() => { window.history.replaceState({}, "", "/"); });

describe("ホームの「新着」", () => {
    it("撮影日が古くても、いちばん新しく投稿した写真が先頭（画面まで配線されている）", () => {
        render(<GalleryPageClient />);
        const panel = document.querySelector('[role="tabpanel"][aria-labelledby="home-tab-all"]')!;
        expect(panel, "新着の面が出ていない").not.toBeNull();
        const ids = [...panel.querySelectorAll("a[data-photo-id]")].map((a) => a.getAttribute("data-photo-id"));
        expect(ids, "撮影日で並べていて、今日の投稿が沈んでいる").toEqual(["old-shot-new-post", "recent-shot", "mid"]);
    });
});
