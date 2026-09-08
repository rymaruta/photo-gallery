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
const mockLikeToggle = vi.hoisted(() => vi.fn(async (): Promise<{ ok: boolean; message?: string }> => ({ ok: true })));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: mockLikeToggle }),
}));
vi.mock("../../../../lib/utils/music", () => ({
    searchSongs: (...a: unknown[]) => mockSearchSongs(...a),
    parseMusicEmbed: () => null,
}));
const mockSearchSongs = vi.hoisted(() => vi.fn());

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

    it("トークン期限切れ（API GW の 401 定型）は再ログインの文言を出す", async () => {
        mockUserFetch.mockResolvedValueOnce({
            ok: false, status: 401, json: async () => ({ message: "Unauthorized" }),
        });
        await saveMv("https://www.youtube.com/watch?v=abc123");
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            "セッションの有効期限が切れています。ログインし直してください", "error"));
        expect(mockShowToast).not.toHaveBeenCalledWith("Unauthorized", "error");
    });

    it("トークン不在（userFetch が投げる）は「時間をおいて」ではなくログインを促す", async () => {
        const { AUTH_REQUIRED_MESSAGE } = await import("../../../../lib/utils/api");
        mockUserFetch.mockRejectedValueOnce(new Error(AUTH_REQUIRED_MESSAGE));
        await saveMv("https://www.youtube.com/watch?v=abc123");
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(AUTH_REQUIRED_MESSAGE, "error"));
    });

    it("保存できたら成功のトースト（今までどおり）", async () => {
        mockUserFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
        await saveMv("https://www.youtube.com/watch?v=abc123");
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("MVを設定しました 🎬", "success"));
    });
});

// いいねの失敗表示と曲検索の失敗表示は「フックが成否を返す」ところまでしか
// 測られておらず、画面側の配線を消しても全テストが通っていた（レビューが
// 変異で実証）。押した人に届くところまで固定する。
describe("いいね・曲検索の失敗が画面に出る", () => {
    it("いいねが失敗したらトーストを出す（SW-b4 の配線）", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        mockLikeToggle.mockResolvedValue({ ok: false });
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        const heart = await screen.findByRole("button", { name: /いいね|Like/ });
        await userEvent.click(heart);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("いいねを保存できませんでした"), "error"));
    });

    // **押し直しても直らない失敗はそう言う。** フックが理由を運ぶように
    // したが、画面がそれを出すかは別の話（無視しても既定文で緑になる）
    it("セッションが切れていたら、その文言をそのまま出す", async () => {
        const { AUTH_REQUIRED_MESSAGE } = await import("../../../../lib/utils/api");
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        mockLikeToggle.mockResolvedValue({ ok: false, message: AUTH_REQUIRED_MESSAGE });
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await userEvent.click(await screen.findByRole("button", { name: /いいね|Like/ }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(AUTH_REQUIRED_MESSAGE, "error"));
        expect(mockShowToast.mock.calls.map((c) => String(c[0])),
            "理由があるのに既定文で塗り潰している").not.toContain(
            expect.stringContaining("いいねを保存できませんでした"));
    });

    it("曲検索が失敗したら理由を出す（SW-b6 の配線）", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        mockSearchSongs.mockRejectedValue(new Error("down"));
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await userEvent.click(await screen.findByRole("button", { name: /BGM/ }));
        const box = await screen.findByPlaceholderText("曲名・アーティスト名");
        await userEvent.type(box, "なにか{Enter}");
        expect(await screen.findByText(/検索に失敗しました/)).toBeInTheDocument();
    });
});

// **閉じたら結果を捨てる。** フックの単体テストでは守れない
// ——フックは正しく、呼ばない画面が問題になる。実際、閉じるボタンから
// `clearSongSearch()` を消してもフルスイートが全緑だった。
describe("曲検索: 閉じたら結果を捨てる", () => {
    it("ピッカーを閉じて開き直すと、前回の結果が残っていない", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        mockSearchSongs.mockResolvedValue([
            { id: "s1", title: "まえのけっか", artist: "誰か", artwork: "", previewUrl: "", trackUrl: "" },
        ]);
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await userEvent.click(await screen.findByRole("button", { name: /BGM/ }));
        const box = await screen.findByPlaceholderText("曲名・アーティスト名");
        await userEvent.type(box, "たび{Enter}");
        expect(await screen.findByText("まえのけっか")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
        await userEvent.click(await screen.findByRole("button", { name: /BGM/ }));

        expect(screen.queryByText("まえのけっか"), "前回の結果が残っている").toBeNull();
    });
});
