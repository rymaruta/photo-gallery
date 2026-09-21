import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import { ja } from "@/app/i18n/labels";

/**
 * 保存した写真（/saves）。**`/favorites`（いいねした写真）とは別のページ**
 * であることが画面から分かること、「まだ／失敗／0件」を混ぜないこと。
 */
const photos: Photo[] = [
    { id: "a", src: "https://cdn.example.com/uploads/a.jpg", title: { ja: "写真A" }, tags: [] },
    { id: "b", src: "https://cdn.example.com/uploads/b.jpg", title: { ja: "写真B" }, tags: [] },
    { id: "c", src: "https://cdn.example.com/uploads/c.jpg", title: { ja: "写真C" }, tags: [] },
] as unknown as Photo[];

const mockUserFetch = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));

vi.mock("../../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos, loaded: true, failed: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: ja }) }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return { ...actual, userFetch: (...a: unknown[]) => mockUserFetch(...a) };
});

const SavesPage = (await import("../page")).default;

const ok = (photoIds: string[]) => ({ ok: true, json: async () => ({ photoIds }) });

beforeEach(() => {
    auth.isAuthenticated = true;
    auth.loading = false;
    mockUserFetch.mockReset().mockResolvedValue(ok([]));
});

describe("保存した写真のページ", () => {
    it("`/user/saves` を引く（いいねの口は叩かない）", async () => {
        mockUserFetch.mockResolvedValue(ok(["b"]));
        render(<SavesPage />);
        await waitFor(() => expect(screen.getByText("保存した写真 1 件")).toBeTruthy());
        expect(mockUserFetch).toHaveBeenCalledWith("/user/saves", expect.anything());
        for (const c of mockUserFetch.mock.calls) expect(String(c[0])).not.toContain("like");
    });

    // **いいねした写真と見分けが付くこと。** どちらも「集めた写真」に
    // 見えるので、題だけでなく「投稿者には伝わらない」ことも言う
    it("いいねした写真とは別物だと画面に書いてある", async () => {
        render(<SavesPage />);
        expect(screen.getByRole("heading", { name: "保存した写真" })).toBeTruthy();
        await waitFor(() => expect(screen.getByText(/投稿者には伝わりません/)).toBeTruthy());
        const link = screen.getByRole("link", { name: "いいねした写真はこちら" });
        expect(link.getAttribute("href")).toBe("/favorites");
    });

    // **サーバーの並び（新しい順）を保つ。** `filter` だけで作ると、
    // 棚の順番がギャラリーの並びに化ける
    it("保存した順（新しい順）に並べる", async () => {
        mockUserFetch.mockResolvedValue(ok(["c", "a"]));
        render(<SavesPage />);
        await waitFor(() => expect(screen.getByText("保存した写真 2 件")).toBeTruthy());
        const shown = screen.getAllByText(/^写真[ABC]$/).map((el) => el.textContent);
        expect(shown).toEqual(["写真C", "写真A"]);
    });

    it("一覧に無い写真（非公開になったぶん）は出さない", async () => {
        mockUserFetch.mockResolvedValue(ok(["z", "a"]));
        render(<SavesPage />);
        await waitFor(() => expect(screen.getByText("保存した写真 1 件")).toBeTruthy());
    });

    // 聞いている途中に「0 件」と言い切ると、別の端末で保存したぶんが
    // 届く前に「無い」と読める
    it("届くまでは「0件」と言わない", () => {
        mockUserFetch.mockImplementation(() => new Promise(() => {}));
        render(<SavesPage />);
        expect(screen.queryByText(/保存した写真はまだありません/)).toBeNull();
        expect(screen.getAllByText("読み込み中…").length).toBeGreaterThan(0);
    });

    it("取りに行って失敗した回は、黙って空の棚を出さない", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        render(<SavesPage />);
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("読み込めませんでした");

        mockUserFetch.mockResolvedValue(ok(["a"]));
        fireEvent.click(screen.getByRole("button", { name: "再試行" }));
        await waitFor(() => expect(screen.getByText("保存した写真 1 件")).toBeTruthy());
    });

    // **未ログインに「まだありません」と言わない。** 保存はログインした
    // 人の機能なので、0件なのではなく「まだ使えない」
    it("未ログインにはログインへの導線を出す（「まだありません」ではなく）", async () => {
        auth.isAuthenticated = false;
        render(<SavesPage />);
        await waitFor(() => expect(screen.getByRole("link", { name: "ログイン" })).toBeTruthy());
        expect(screen.queryByText(/保存した写真はまだありません/)).toBeNull();
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("ログイン中で0件なら、押し方を案内する", async () => {
        render(<SavesPage />);
        await waitFor(() => expect(screen.getByText(/保存した写真はまだありません/)).toBeTruthy());
        expect(screen.getByText(/しおり（保存）を押すと/)).toBeTruthy();
    });
});
