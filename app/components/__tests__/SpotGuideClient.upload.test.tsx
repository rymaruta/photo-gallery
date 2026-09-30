import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";
import type { Photo } from "@/lib/data/photos";

/**
 * **スポットの画面の「ここで撮った写真を投稿する」は、スポットを運ぶ。**
 * 運ばないと、投稿画面は `spotId` を送れず、その写真はこの一覧に並ばない。
 * 戻ってきたとき（`?posted=1`）は、まだ並んでいないことを言う（静的なページなので）。
 */
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn(async () => ({ ok: true, json: async () => ({ slugs: [] }) })) }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotGuideClient from "../SpotGuideClient";

const SPOT: Spot = {
    spotId: "sp_92dc681b0f47",
    slug: "ginzan-onsen",
    name: "銀山温泉",
    summary: "あ".repeat(40),
    region: { country: "日本", prefecture: "山形県", city: "尾花沢市" },
    coords: { lat: 38.58, lng: 140.53 },
    highlights: ["木造多層の旅館"],
    officialWebsiteUrl: "https://example.example/",
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-09-23",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
};

const view = (photos: Photo[] = []) => render(
    <ToastProvider>
        <SpotGuideClient spot={SPOT} photos={photos} nearby={[]} locationPath={null} />
    </ToastProvider>,
);

beforeEach(() => {
    window.history.replaceState(null, "", "/spots/ginzan-onsen");
});

describe("スポットの画面から投稿へ", () => {
    it("写真が0枚: 投稿のリンクがスポットを運ぶ", () => {
        view();
        const link = screen.getByRole("link", { name: "ここで撮った写真を投稿する" });
        expect(link.getAttribute("href")).toBe("/user/upload?spot=ginzan-onsen");
    });

    it("写真がある場所にも、スポットを運ぶ投稿のリンクがある", () => {
        view([{ id: "p1", src: "/uploads/a.jpg", title: "a", spotId: SPOT.spotId } as Photo]);
        const link = screen.getByRole("link", { name: "ここで撮った写真を投稿する" });
        expect(link.getAttribute("href")).toBe("/user/upload?spot=ginzan-onsen");
    });

    it("?posted=1 で戻ってきたら「まだ並んでいない」ことを言い、URL から外す", async () => {
        window.history.replaceState(null, "", "/spots/ginzan-onsen?posted=1");
        view();
        expect((await screen.findByTestId("spot-posted-note")).textContent).toContain("サイトの更新が終わってから");
        expect(window.location.search).toBe("");
    });

    // 投稿画面が読む本文 JSON は公開済みの分しか無い。下書きの画面から運ぶと毎回読めない
    it("下書きの場所からは、スポットを運ばない（普通の投稿画面へ）", () => {
        render(
            <ToastProvider>
                <SpotGuideClient spot={{ ...SPOT, status: "review", verifiedAt: undefined, draftedAt: "2026-09-24" } as Spot}
                                 photos={[]} nearby={[]} locationPath={null} />
            </ToastProvider>,
        );
        const link = screen.getByRole("link", { name: "ここで撮った写真を投稿する" });
        expect(link.getAttribute("href")).toBe("/user/upload");
    });

    it("普通に開いたときは出さない", () => {
        view();
        expect(screen.queryByTestId("spot-posted-note")).toBeNull();
    });
});
