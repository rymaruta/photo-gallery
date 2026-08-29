import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **削除が断られたときの理由を潰していた。**
//
// サーバーは「画像を消せなかったので行を残した」＝押し直せば続きから
// 消える、と読める文言を返すようになった（`api-user/src/stories.ts`）。
// ところがクライアントは番号だけを投げていたので、画面には
// 「削除に失敗しました」しか出ず、**もう一度押せばよいことが伝わらない**。
// 他の経路（BGM保存・非公開切替・下書き保存・管理削除・アップロード）は
// 既に `readApiError` に揃えてある。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, userId: "me" }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    isGoneResponse: async (res: { status: number }) => res.status === 404,
    readApiError: async (res: { json: () => Promise<{ error?: string }> }, fallback: string) => {
        try { return (await res.json()).error ?? fallback; } catch { return fallback; }
    },
}));

import StoriesBar from "../StoriesBar";

const STORY = {
    id: "s1", userId: "me", src: "https://cdn.example.com/uploads/me/a.jpg",
    mediaType: "image", createdAt: "2026-08-29T00:00:00Z", expiresAt: "2026-08-30T00:00:00Z",
};

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

/** 自分のストーリーを開いて削除ボタンまで進める */
async function openAndDelete(deleteResponse: Record<string, unknown>) {
    mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
        if (url === "/stories" && !init?.method) {
            return Promise.resolve({ ok: true, json: async () => [STORY] });
        }
        if (url.startsWith("/stories/") && init?.method === "DELETE") {
            return Promise.resolve(deleteResponse);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { container } = render(<StoriesBar />);
    await screen.findByText("あなた");
    // 「あなた」の枠を押す（ストーリーがあるときは見る、無いときは選ぶ）。
    // テキストではなくボタン自体を押す
    const ownButton = container.querySelector("button") as HTMLButtonElement;
    await userEvent.click(ownButton);
    await userEvent.click(await screen.findByLabelText("ストーリーを削除"));
    // 確認ダイアログの「削除」を押す
    await userEvent.click(await screen.findByRole("button", { name: "削除" }));
}

describe("ストーリー削除が断られたとき", () => {
    it("サーバーの理由をそのまま出す（押し直せると伝わる）", async () => {
        await openAndDelete({
            ok: false, status: 500,
            json: async () => ({ error: "画像の削除を完了できませんでした。時間をおいてもう一度お試しください" }),
        });

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("もう一度"), "error"));
    });

    it("理由が無ければ、これまでどおりの文言にする", async () => {
        await openAndDelete({ ok: false, status: 502, json: async () => { throw new Error("not json"); } });

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("削除に失敗しました", "error"));
    });

    it("消えていれば成功として扱う（404）", async () => {
        await openAndDelete({ ok: false, status: 404, json: async () => ({}) });

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("削除しました"), "success"));
    });
});
