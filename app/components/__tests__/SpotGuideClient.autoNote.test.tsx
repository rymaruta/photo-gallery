import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";
import type { Photo } from "@/lib/data/photos";

/**
 * 撮影スポットの頁の写真の節: 自動で結んだ写真を含むときだけ
 * 「撮影地の名前と位置から自動で結んだ写真を含みます。」と小さく断る（2026-10-31・journey.photo-ios#425・板 SpotWeb）
 */
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn(async () => ({ ok: true, json: async () => ({ slugs: [] }) })) }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotGuideClient from "../SpotGuideClient";

const SPOT: Spot = {
    spotId: "sp_000000000001",
    slug: "miyagi-zao-fox",
    name: "蔵王キツネ村",
    summary: "あ".repeat(40),
    region: { country: "日本", prefecture: "宮城県", city: "白石市" },
    coords: { lat: 38.02, lng: 140.55 },
    highlights: ["キツネ"],
    officialWebsiteUrl: "https://example.example/",
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-10-31",
    createdAt: "2026-10-31T00:00:00.000Z",
    updatedAt: "2026-10-31T00:00:00.000Z",
};
const PHOTO = { id: "p1", src: "https://cdn.example.com/a.webp", title: "夢の中" } as Photo;

const view = (autoNote: boolean) => render(
    <ToastProvider>
        <SpotGuideClient spot={SPOT} photos={[PHOTO]} autoNote={autoNote} nearby={[]} locationPath={null} />
    </ToastProvider>,
);

beforeEach(() => {
    window.history.replaceState(null, "", "/spots/miyagi-zao-fox");
});

describe("撮影スポットの頁: 自動で結んだ写真の注記", () => {
    it("自動で結んだ写真を含むときは注記を出す（数は自動の分も数える）", () => {
        view(true);
        expect(screen.getByRole("heading", { name: "この撮影スポットの写真（1）" })).toBeTruthy();
        expect(screen.getByTestId("spot-auto-note").textContent).toBe("撮影地の名前と位置から自動で結んだ写真を含みます。");
    });

    it("本人が選んだ写真だけなら出さない", () => {
        view(false);
        expect(screen.queryByTestId("spot-auto-note")).toBeNull();
    });
});
