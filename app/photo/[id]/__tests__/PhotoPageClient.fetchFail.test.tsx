import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// 静的ビルドに未収録の新着写真のURL（通知・シェア経由）で、API の取得が
// 一時的に失敗すると「写真が見つかりません＝存在しません」と断定していた。
// 実在する写真が「消された」ように読める（SW-b7）。失敗中は断定せず、
// 再試行を出す。

const mockPublicFetch = vi.hoisted(() => vi.fn());

vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: {} }),
}));
vi.mock("../../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    publicFetch: (...args: unknown[]) => mockPublicFetch(...args),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/ProfileLink", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn(async () => ({ ok: true })) }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const newPhoto = {
    id: "new-photo",
    src: "https://cdn.example.com/uploads/u1/new.jpg",
    userId: "u1",
    title: "新着",
    exif: { Model: "X-T5" },
};

beforeEach(() => mockPublicFetch.mockReset());

describe("静的データに無い写真 × API失敗", () => {
    it("「存在しません」と断定せず、再試行で立て直す", async () => {
        mockPublicFetch
            .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
            .mockResolvedValueOnce({ ok: true, json: async () => [newPhoto] });

        // initialPhoto なし（静的ビルドに未収録の想定）
        render(<PhotoPageClient photoId="new-photo" />);

        expect(await screen.findByText("写真を読み込めませんでした")).toBeInTheDocument();
        expect(screen.queryByText("写真が見つかりません")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
        expect(await screen.findByRole("heading", { name: "新着" })).toBeInTheDocument();
    });

    it("空の 200 でも「存在しません」とは断定しない（怪しい空応答）", async () => {
        // 隣のガード（空配列で静的データを潰さない）と同じ疑い方。
        // 静的未収録の新着写真URL × 怪しい空200 で 404 断定しない
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => [] });
        render(<PhotoPageClient photoId="new-photo" />);
        expect(await screen.findByText("写真を読み込めませんでした")).toBeInTheDocument();
        expect(screen.queryByText("写真が見つかりません")).toBeNull();
    });

    it("API が成功して本当に無いときは今までどおり「見つかりません」", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => [newPhoto] });
        render(<PhotoPageClient photoId="really-missing" />);
        expect(await screen.findByText("写真が見つかりません")).toBeInTheDocument();
    });
});
