import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import { ja } from "@/app/i18n/labels";

/**
 * 「いいねした写真」が、**この端末で押したぶんしか出なかった**件。
 *
 * owner の報告:「いいねした写真を見てもいいねした写真がない」。
 * 再現（本物のビルド＋Chromium）:
 *
 *     サーバーにいいねが在り、この端末の控えが空
 *       → いいねした写真: 0件
 *       → 同じ写真のページ: 「いいねを取り消す」（＝いいね済み）
 *
 * 同じアカウントで画面どうしが食い違っていた。原因は
 * **サーバーに「自分がいいねした写真」を引く口が無かった**こと
 * （あるのは1枚ずつ聞く `GET /user/likes/{id}` だけ）。
 */
const photos: Photo[] = [
    { id: "a", src: "https://cdn.example.com/uploads/a.jpg", title: { ja: "写真A" }, tags: [] },
    { id: "b", src: "https://cdn.example.com/uploads/b.jpg", title: { ja: "写真B" }, tags: [] },
    { id: "c", src: "https://cdn.example.com/uploads/c.jpg", title: { ja: "写真C" }, tags: [] },
] as unknown as Photo[];

const mockUserFetch = vi.hoisted(() => vi.fn());
const localFavorites = vi.hoisted(() => ({ ids: [] as string[] }));
const auth = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));

vi.mock("../../../lib/hooks/useFavorites", () => ({
    useFavorites: () => ({ favorites: localFavorites.ids, isFavorite: () => false, toggle: vi.fn() }),
}));
vi.mock("../../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos, loaded: true, failed: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: ja }) }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return { ...actual, userFetch: (...a: unknown[]) => mockUserFetch(...a) };
});

const FavoritesPage = (await import("../page")).default;

const ok = (photoIds: string[]) => ({ ok: true, json: async () => ({ photoIds }) });
const titles = () => screen.queryAllByText(/^写真[ABC]$/).map((e) => e.textContent);

beforeEach(() => {
    localFavorites.ids = [];
    auth.isAuthenticated = true;
    auth.loading = false;
    mockUserFetch.mockReset().mockResolvedValue(ok([]));
});

describe("いいねした写真（サーバー側の一覧）", () => {
    it("別の端末で押したいいねも出る", async () => {
        mockUserFetch.mockResolvedValue(ok(["b", "c"]));
        render(<FavoritesPage />);
        await waitFor(() => expect(titles()).toEqual(["写真B", "写真C"]));
        expect(mockUserFetch.mock.calls[0][0], "サーバーに聞いていない").toBe("/user/likes");
    });

    it("この端末で押したぶんと足し合わせる（未ログイン中に押したぶんを捨てない）", async () => {
        localFavorites.ids = ["a"];
        mockUserFetch.mockResolvedValue(ok(["c"]));
        render(<FavoritesPage />);
        await waitFor(() => expect(titles()).toEqual(["写真A", "写真C"]));
    });

    it("重なっていても二重に出さない", async () => {
        localFavorites.ids = ["a", "b"];
        mockUserFetch.mockResolvedValue(ok(["b"]));
        render(<FavoritesPage />);
        await waitFor(() => expect(titles()).toEqual(["写真A", "写真B"]));
    });

    // **「まだ」と「0件」を混ぜない。** 聞いている途中に「ありません」と
    // 言い切ると、別の端末で押したぶんが届く前に「無い」と読める
    it("聞いている間は「ありません」と言い切らない", async () => {
        mockUserFetch.mockReturnValue(new Promise(() => { /* 返らない */ }));
        render(<FavoritesPage />);
        expect(screen.queryByText(/いいねした写真はまだありません/), "届く前に言い切っている").toBeNull();
        expect(screen.getAllByText(/読み込み中/).length).toBeGreaterThan(0);
    });

    it("ログイン確認中も言い切らない", () => {
        auth.loading = true;
        render(<FavoritesPage />);
        expect(screen.queryByText(/いいねした写真はまだありません/)).toBeNull();
        expect(mockUserFetch, "ログイン状態が決まる前に聞きに行っている").not.toHaveBeenCalled();
    });

    it("未ログインなら聞きに行かず、端末の控えだけを出す", async () => {
        auth.isAuthenticated = false;
        localFavorites.ids = ["a"];
        render(<FavoritesPage />);
        await waitFor(() => expect(titles()).toEqual(["写真A"]));
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("本当に0件なら「ありません」を出す", async () => {
        render(<FavoritesPage />);
        await waitFor(() => expect(screen.getByText(/いいねした写真はまだありません/)).toBeInTheDocument());
    });

    // **失敗を0件に混ぜない。** 端末の控えぶんは出るので、
    // 足りていないことだけ伝えて、もう一度聞けるようにする
    it("聞けなかったら、その旨と再試行を出す", async () => {
        localFavorites.ids = ["a"];
        mockUserFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
        render(<FavoritesPage />);
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("読み込めませんでした");
        expect(titles(), "端末の控えまで消している").toEqual(["写真A"]);

        mockUserFetch.mockResolvedValue(ok(["c"]));
        fireEvent.click(screen.getByRole("button", { name: "再試行" }));
        await waitFor(() => expect(titles()).toEqual(["写真A", "写真C"]));
        expect(screen.queryByRole("alert"), "直ったのに警告が残っている").toBeNull();
    });

    it("投げても画面は落ちない（控えぶんは出す）", async () => {
        localFavorites.ids = ["b"];
        mockUserFetch.mockRejectedValue(new Error("offline"));
        render(<FavoritesPage />);
        expect(await screen.findByRole("alert")).toBeInTheDocument();
        expect(titles()).toEqual(["写真B"]);
    });

    // 形の違う応答で画面ごと落とさない（`usableRows` と同じ判断）
    it("配列でない応答は失敗として扱う", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ photoIds: "oops" }) });
        render(<FavoritesPage />);
        expect(await screen.findByRole("alert")).toBeInTheDocument();
    });

    // サーバーの一覧には、非公開に戻された写真のIDも混ざりうる
    it("手元の一覧に無いIDは黙って捨てる", async () => {
        mockUserFetch.mockResolvedValue(ok(["a", "消えた写真"]));
        render(<FavoritesPage />);
        await waitFor(() => expect(titles()).toEqual(["写真A"]));
    });
});
