import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * 写真の上の地図ボタン。**押せる大きさは 44px**（見た目の丸は 36px のまま）。
 * 36px の丸をそのまま当たりにしていて、指では外しやすかった。
 */
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    publicFetch: vi.fn(() => new Promise(() => undefined)),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn() }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

describe("写真の上の地図ボタン", () => {
    it("当たりは 44px 四方", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{
            id: "p1", src: "https://cdn.example.com/uploads/alice/a.webp", title: "朝の湖", userId: "alice",
            location: "銀山温泉", coords: { lat: 38.58, lng: 140.53 },
        } as unknown as Photo} />);
        const link = await screen.findByRole("link", { name: "撮影地マップで見る" });
        expect(link.style.width).toBe("44px");
        expect(link.style.height).toBe("44px");
    });
});
