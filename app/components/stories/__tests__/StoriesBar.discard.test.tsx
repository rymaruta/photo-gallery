import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ストーリーの投稿も「S3 に上げる → DynamoDB に書く」の2段。
//  - 保存で断られた（投稿上限 429 など）とき、先に上げた実体が公開のまま残る。
//    どの削除経路も DynamoDB の項目からキーを引くので、誰にも辿れない（3-5）。
//  - 準備（presign）で断られたとき、番号だけを投げていたので
//    「投稿に失敗しました」にまとめられ、断られた理由が伝わらない（F8）。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null } }));

vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (res: Response, fallback: string) => {
        try {
            const d = await res.json() as { error?: string };
            return d.error ?? fallback;
        } catch { return fallback; }
    },
}));

// 画像の縮小は canvas を使うので jsdom では通らない。
// ここは「保存に失敗したあとの後始末」を見るテストなので素通しにする。
vi.mock("@/lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
}));

import StoriesBar from "../StoriesBar";

const KEY = "uploads/me/story.jpg";
const PUBLIC_URL = `https://cdn.example.com/${KEY}`;

/** presign と S3 の PUT を成功させる既定の応答（保存の結果は呼び出し側で差し替える） */
function api() {
    return (url: string) => {
        if (url === "/stories") {
            // 一覧の取得（GET）は空で返す
            return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (url === "/upload/presigned-url") {
            return Promise.resolve({
                ok: true,
                json: async () => ({ presignedUrl: "https://s3.example/put", publicUrl: PUBLIC_URL, key: KEY }),
            });
        }
        if (url === "/user/profile") return Promise.resolve({ ok: true, json: async () => ({}) });
        return Promise.resolve({ ok: true, json: async () => ({}) });
    };
}

const discardCalls = () => mockUserFetch.mock.calls.filter((c) => c[0] === "/upload/discard");

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockImplementation(api());
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

/** 「あなた」からファイルを選んで下書きを開き、投稿ボタンまで進める */
async function postStory() {
    const { container } = render(<StoriesBar />);
    await screen.findByText("あなた");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "story.jpg", { type: "image/jpeg" }));
    const post = await screen.findByRole("button", { name: /ストーリーに投稿/ });
    await userEvent.click(post);
}

describe("ストーリー投稿が断られたとき", () => {
    it("投稿上限(429)なら、先に上げた実体を消す", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (url === "/stories" && init?.method === "POST") {
                return Promise.resolve({ ok: false, status: 429, json: async () => ({ error: "本日の投稿上限に達しています" }) });
            }
            return api()(url);
        });

        await postStory();

        await waitFor(() => expect(discardCalls()).toHaveLength(1));
        const [, init] = discardCalls()[0] as [string, { method: string; body: string }];
        expect(init.method).toBe("DELETE");
        expect(JSON.parse(init.body)).toEqual({ key: KEY });
        // 断られた理由はそのまま伝える
        expect(mockShowToast).toHaveBeenCalledWith("本日の投稿上限に達しています", "error");
    });

    it("投稿が通れば実体は消さない（ストーリーが使っている）", async () => {
        await postStory();
        await waitFor(() => expect(
            mockUserFetch.mock.calls.some((c) => c[0] === "/stories" && (c[1] as { method?: string } | undefined)?.method === "POST"),
        ).toBe(true));
        await new Promise((r) => setTimeout(r, 20));
        expect(discardCalls()).toHaveLength(0);
    });

    // 番号だけを投げていた頃は、下の catch が「投稿に失敗しました」に
    // まとめてしまい、断られた理由（枚数を確認できなかった 503 など）が
    // 画面に出なかった。
    it("準備で断られたら、サーバーの文言をそのまま出す", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/upload/presigned-url") {
                return Promise.resolve({
                    ok: false, status: 503,
                    json: async () => ({ error: "枚数を確認できませんでした。時間をおいてもう一度お試しください" }),
                });
            }
            return api()(url);
        });

        await postStory();

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            "枚数を確認できませんでした。時間をおいてもう一度お試しください", "error",
        ));
    });
});

// !ok の分岐だけで消していた頃は、オフライン・DNS 失敗などで
// userFetch("/stories") 自体が**投げる**と打ち消しを通らず、
// S3 に上げただけの孤児が残った（再投稿のたびに増える）。
describe("保存が例外で終わったとき", () => {
    it("通信ごと失敗しても、先に上げた実体を消す", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (url === "/stories" && init?.method === "POST") {
                return Promise.reject(new Error("network down"));
            }
            return api()(url);
        });

        await postStory();

        await waitFor(() => expect(discardCalls()).toHaveLength(1));
        const [, init] = discardCalls()[0] as [string, { body: string }];
        expect(JSON.parse(init.body)).toEqual({ key: KEY });
        // 失敗自体は伝える
        expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "error");
    });
});
