import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 一般ユーザーには自分の写真を消す手段が無かった。できるのは非公開に
// することだけで、S3 の実体（GPS 入りの原本を含む）は残っていた。
// 取り消せない操作なので、確認を1枚挟む（ストーリー削除と同じ形）。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (res: Response, fallback: string) => {
        try {
            const d = await res.json() as { error?: string };
            return d.error ?? fallback;
        } catch { return fallback; }
    },
}));

const EditPage = (await import("../page")).default;

const PHOTO = { id: "p1", src: "https://cdn/x/p1.jpg", userId: "me", published: true, title: "湖" };

/** DELETE /photos/p1 の呼び出し */
const deleteCalls = () => mockUserFetch.mock.calls
    .filter((c) => c[1]?.method === "DELETE");

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation((url: string, init?: { method?: string }) => {
        if (!init?.method) return Promise.resolve({ ok: true, json: async () => [PHOTO] });
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    mockShowToast.mockReset();
    mockPush.mockReset();
    mockReplace.mockReset();
});

/** 確認ダイアログの中の「削除」（アクションバーのものと区別する） */
async function confirmButton() {
    const dialog = await screen.findByRole("dialog");
    const { getByRole } = await import("@testing-library/react").then((m) => m.within(dialog));
    return getByRole("button", { name: "削除" });
}

async function openEditor() {
    render(<EditPage />);
    await screen.findByDisplayValue("湖");
}

describe("写真の削除", () => {
    it("確認を挟む。押しただけでは消さない", async () => {
        await openEditor();
        await userEvent.click(screen.getByRole("button", { name: "削除" }));

        expect(await screen.findByText(/取り消せません/)).toBeInTheDocument();
        expect(deleteCalls()).toHaveLength(0);
    });

    it("確認してから DELETE /photos/{id} を投げ、一覧へ戻る", async () => {
        await openEditor();
        await userEvent.click(screen.getByRole("button", { name: "削除" }));
        await userEvent.click(await confirmButton());

        await waitFor(() => expect(deleteCalls()).toHaveLength(1));
        expect(deleteCalls()[0][0]).toBe("/photos/p1");
        // **replace で戻る。** push だと、戻ったときに消した写真の編集画面が
        // 再マウントされ「写真が見つかりません」を出してまた送り返す
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/user/drafts"));
        expect(mockPush, "push だと、消した写真の編集画面が履歴に残る").not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("削除しました"), "success");
    });

    // **消したのに、検索から開ける個別ページは残っている。** サーバーが
    // 掃除を頼めなかったときは応答に `staticStale` が乗るので、そのまま伝える
    it("静的ページが残るなら、削除のトーストにそう添える", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (!init?.method) return Promise.resolve({ ok: true, json: async () => [PHOTO] });
            return Promise.resolve({ ok: true, json: async () => ({ success: true, staticStale: true }) });
        });
        await openEditor();
        await userEvent.click(screen.getByRole("button", { name: "削除" }));
        await userEvent.click(await confirmButton());

        await waitFor(() => expect(deleteCalls()).toHaveLength(1));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        const msg = String(mockShowToast.mock.calls[0][0]);
        expect(msg).toContain("写真を削除しました");
        expect(msg, "消えていないのに「消した」だけを出している").toContain("残ることがあります");
    });

    it("掃除が頼めていれば、余計なことは言わない", async () => {
        await openEditor();
        await userEvent.click(screen.getByRole("button", { name: "削除" }));
        await userEvent.click(await confirmButton());
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(String(mockShowToast.mock.calls[0][0])).toBe("写真を削除しました");
    });

    it("キャンセルしたら消さない", async () => {
        await openEditor();
        await userEvent.click(screen.getByRole("button", { name: "削除" }));
        await userEvent.click(await screen.findByRole("button", { name: "キャンセル" }));

        await waitFor(() => expect(screen.queryByText(/取り消せません/)).toBeNull());
        expect(deleteCalls()).toHaveLength(0);
    });

    // サーバーは「押し直せば続きから消える」と読める理由を返す
    // （画像が消せなかったときは行を残して 500）。潰さずそのまま出す。
    // **ダイアログも開いたままにする**——閉じるとトーストが数秒で消えた
    // あと、押し直すには最初からやり直しになる。
    it("サーバーが断った理由をそのまま出し、画面に留まる", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (!init?.method) return Promise.resolve({ ok: true, json: async () => [PHOTO] });
            return Promise.resolve({
                ok: false, status: 500,
                json: async () => ({ error: "画像の削除を完了できませんでした。時間をおいてもう一度お試しください" }),
            });
        });
        await openEditor();
        await userEvent.click(screen.getByRole("button", { name: "削除" }));
        await userEvent.click(await confirmButton());

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("画像の削除を完了できませんでした"), "error"));
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReplace, "失敗したのに遷移している").not.toHaveBeenCalled();
        // 押し直せるように開いたまま
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // いいねマーカーは like#<photoId>#<userId> の独立行で、削除では消していない
    // （退会が v1 スコープ外と書いているのと同じ）。約束は実態に合わせる。
    it("確認の文言が、実際に消すものだけを言う", async () => {
        await openEditor();
        await userEvent.click(screen.getByRole("button", { name: "削除" }));
        const text = (await screen.findByRole("dialog")).textContent ?? "";
        expect(text).toContain("画像とコメント");
        expect(text).not.toContain("いいね");
    });
});
