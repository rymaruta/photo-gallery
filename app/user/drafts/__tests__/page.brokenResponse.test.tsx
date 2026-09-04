import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// **取得の失敗を「下書き0件」に混ぜない。**
//
// このファイル（`app/user/drafts/page.tsx`）自身のコメントが
// 「失敗を『下書き0件』と同じ見た目にすると、保存した下書きが消えたように
// 見える（実際はサーバーに残っている）」と書いている。ところが応答が
// 配列でないときは `setDrafts([])` に落ちて `loadError` が立たず、
// 「下書きはありません」＋アップロードの誘導が出ていた。
// 同じ周に `user/edit` で同じ判断をしながら、ここを見落としていた。

const mockUserFetch = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja" }),
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...args: unknown[]) => mockUserFetch(...args),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const DraftsPage = (await import("../page")).default;

beforeEach(() => mockUserFetch.mockReset());

describe("下書きの取得が想定と違ったとき", () => {
    it.each([
        ["配列でない（オブジェクト）", { items: [] }],
        ["null", null],
        ["文字列", "[]"],
    ])("%s なら『0件』ではなく失敗として出す", async (_name, body) => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => body });
        render(<DraftsPage />);
        expect(await screen.findByText(/読み込めませんでした|失敗/),
            "『下書きはありません』に混ぜている（消えたように見える）").toBeInTheDocument();
    });

    // **本当に0件のときは、今までどおり「ありません」**（失敗と混ぜない、の逆向き）
    it("本当に0件なら『ありません』を出す", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => [] });
        render(<DraftsPage />);
        expect(await screen.findByText(/下書きはありません/)).toBeInTheDocument();
    });

    // 読めない行が混じっても、残りの下書きは出る
    it("読めない行は落として、残りは出す", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true,
            json: async () => [{ id: "d1", src: "https://cdn/d1.jpg", published: false, title: "残る下書き" }, null],
        });
        render(<DraftsPage />);
        expect(await screen.findByText("残る下書き")).toBeInTheDocument();
    });
});
