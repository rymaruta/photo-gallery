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

// 期限は現在時刻からの相対で作る。
// **かつては必須だった**——`groupStories` が端末の時計で
// `Date.parse(expiresAt) > now` を見ていたので、固定の日付だと時計がその日を
// 追い越した瞬間に落ちる「時限式のテスト」になっていた。
// その判定は `cf7ac018` で撤去した（サーバーが絞るので、端末の時計で消すと
// 時計が進んでいる人だけストーリーが消える）ので、いまは固定日でも通る。
// **相対のままにしておく**のは、本番のデータの形（いま生きているストーリー）に
// 近いから。ここに期限判定が戻ってきたら、それは撤去した理由ごと戻っている。
const STORY = {
    id: "s1", userId: "me", src: "https://cdn.example.com/uploads/me/a.jpg",
    mediaType: "image",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
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

/**
 * 自分のストーリーを開いて削除まで進める。
 *
 * **一覧が届くのを待ってから押す。** 「あなた」の枠は、ストーリーが
 * 無ければファイル選択を開くボタンで、届いて初めて「見る」に変わる
 * （`aria-label` がそこで切り替わる）。テキストだけ待って押していたので、
 * 一覧の到着が間に合わないと**ファイル選択が開くだけ**で先へ進めず、
 * `findByLabelText` が既定の1秒を使い切って落ちていた
 * ——ラベルで待てば、押せる状態になったことまで確かめられる。
 */
async function openOwnStoryAndDelete() {
    await userEvent.click(await screen.findByLabelText("自分のストーリーを見る"));
    await userEvent.click(await screen.findByLabelText("ストーリーを削除"));
    // 確認ダイアログの「削除」を押す
    await userEvent.click(await screen.findByRole("button", { name: "削除" }));
}

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

    render(<StoriesBar />);
    await openOwnStoryAndDelete();
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

    // **ここが今回入れた漏れ。** `userFetch` は `fetch` をそのまま返すので、
    // 機内モードでは `TypeError: Failed to fetch` が飛ぶ。`e.message` を
    // そのまま出す形にしていたので、**英語の技術文字列が画面に並んで**いた
    // （アップロード画面が同じ事故で境界を作ってあるのに、使っていなかった）
    it("通信が落ちたときに、英語の技術文字列を出さない", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (url === "/stories" && !init?.method) {
                return Promise.resolve({ ok: true, json: async () => [STORY] });
            }
            if (url.startsWith("/stories/") && init?.method === "DELETE") {
                return Promise.reject(new TypeError("Failed to fetch"));
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<StoriesBar />);
        await openOwnStoryAndDelete();

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("削除に失敗しました", "error"));
        const shown = String(mockShowToast.mock.calls[0][0]);
        expect(shown, "英語の技術文字列がそのまま出ている").not.toContain("Failed to fetch");
    });

    it("消えていれば成功として扱う（404）", async () => {
        await openAndDelete({ ok: false, status: 404, json: async () => ({}) });

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("削除しました"), "success"));
    });
});
