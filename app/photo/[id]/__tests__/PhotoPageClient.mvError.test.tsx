import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Photo } from "@/lib/data/photos";

// MV設定（YouTube リンク）の保存失敗が、理由を問わず一律
// 「YouTubeリンクが正しくありません」になっていた。通信断・認証切れ・500 でも
// 同じ表示なので、正しいリンクを何度も貼り直させる。サーバーの文言
// （400 なら「不正なYouTube URLです」）をそのまま出すことを固定する。

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();

vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, userId: "owner-1", loading: false }),
}));
vi.mock("../../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: {} }),
}));
vi.mock("../../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));
// readApiError は本物を使う（この配線こそが直した対象）。fetch だけ差し替える
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: (...args: unknown[]) => mockUserFetch(...args),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
// 写真ページの脇役は描かない（それぞれ自分のテストを持っている）
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/ProfileLink", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn() }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

// オーナー（useAuth の userId と一致）の公開写真。exif を持たせて
// クライアント側の EXIF 再抽出を走らせない
const photo: Photo = {
    id: "p1",
    src: "https://cdn.example.com/uploads/owner-1/a.jpg",
    userId: "owner-1",
    title: "テスト写真",
    exif: { Model: "X-T5" },
} as unknown as Photo;

async function saveMv(url: string) {
    render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
    const input = await screen.findByPlaceholderText(/YouTubeリンクを貼るとフル再生MVに/);
    await userEvent.type(input, url);
    await userEvent.click(screen.getByRole("button", { name: "MV設定" }));
}

beforeEach(() => {
    mockShowToast.mockReset();
    // 写真一覧の再取得（マウント時）は失敗扱いで流す（initialPhoto で描ける）
    mockUserFetch.mockReset();
});

describe("MV設定の失敗理由が伝わる", () => {
    it("400 はサーバーの文言を出す（一律の文言に潰さない）", async () => {
        mockUserFetch.mockResolvedValueOnce({
            ok: false, status: 400, json: async () => ({ error: "不正なYouTube URLです" }),
        });
        await saveMv("https://example.com/not-youtube");
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("不正なYouTube URLです", "error"));
    });

    it("500 など文言の無い失敗は保存できなかった旨を出す（リンクのせいにしない）", async () => {
        mockUserFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
        await saveMv("https://www.youtube.com/watch?v=abc123");
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("MVを保存できませんでした", "error"));
        expect(mockShowToast).not.toHaveBeenCalledWith("YouTubeリンクが正しくありません", "error");
    });

    it("通信断はその旨を出す（リンクのせいにしない）", async () => {
        mockUserFetch.mockRejectedValueOnce(new Error("network down"));
        await saveMv("https://www.youtube.com/watch?v=abc123");
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            "通信に失敗しました。時間をおいてもう一度お試しください", "error"));
    });

    it("保存できたら成功のトースト（今までどおり）", async () => {
        mockUserFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
        await saveMv("https://www.youtube.com/watch?v=abc123");
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("MVを設定しました 🎬", "success"));
    });
});
