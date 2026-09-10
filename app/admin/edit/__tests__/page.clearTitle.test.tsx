import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **日本語を空にしても、英語が残って表示に出ていた。**
//
// この画面には英語の入力欄が無い（state には読み込むが描画しない）のに、
// 保存時は `{ ja: titleJa, en: titleEn }` を送っていた。日本語を空にすると
// `{ ja:"", en:"..." }` になり、サーバーは英語だけを残す——表示は
// `getLocalized` のフォールバックで**英語が出る**ので、消したつもりの
// 文字列が英訳のまま残り、しかもこの画面から戻す手段が無い。

const mockAuthFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ id: "A" as string | null }));
const stableRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("next/navigation", () => ({
    useRouter: () => stableRouter,
    useSearchParams: () => ({ get: (k: string) => (k === "id" ? q.id : null) }),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
// **実物を土台にする。** 列挙だけだと、実装が新しく使い始めた export
// （`readApiError`）が undefined になり、**その分岐を通るテストだけ**が
// 落ちる（台帳の型: 分岐の中で初めて使う値は、その分岐を通るテストでしか
// 露見しない）
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    authenticatedFetch: mockAuthFetch,
}));

const EditPage = (await import("../page")).default;

const PHOTO = {
    id: "A", src: "https://cdn/A.jpg",
    title: { en: "Morning Sea", ja: "海の朝" },
    description: { en: ["Old line"], ja: ["旧い説明"] },
    location: "北海道", category: "風景", date: "2024-10-12T00:00:00.000Z",
    tags: ["朝"], published: true, exif: {},
};

beforeEach(() => {
    q.id = "A";
    mockShowToast.mockReset();
    mockAuthFetch.mockReset().mockImplementation((_url: string, init?: { method?: string }) =>
        Promise.resolve(init?.method === "PUT"
            ? { ok: true, json: async () => ({ success: true }) }
            : { ok: true, json: async () => [PHOTO] }));
});

const putBody = () => {
    const put = mockAuthFetch.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT");
    return put ? JSON.parse((put[1] as { body: string }).body) as Record<string, unknown> : null;
};

describe("/admin/edit: 日本語を空にしたとき", () => {
    it("英語ごと消す（英語だけ残さない）", async () => {
        render(<EditPage />);
        const title = await screen.findByDisplayValue("海の朝");

        await userEvent.clear(title);
        await userEvent.click(screen.getByRole("button", { name: /保存|更新/ }));

        await waitFor(() => expect(putBody()).not.toBeNull());
        expect(putBody()?.title, "英語だけ残って、消したはずの文字が英語で出る").toBe("");
    });

    it("説明も同じ（空にしたら英語ごと消える）", async () => {
        render(<EditPage />);
        const desc = await screen.findByDisplayValue("旧い説明");

        await userEvent.clear(desc);
        await userEvent.click(screen.getByRole("button", { name: /保存|更新/ }));

        await waitFor(() => expect(putBody()).not.toBeNull());
        expect(putBody()?.description, "英語の段落が残っている").toBe("");
    });

    // **「この編集で空にした」と「もともと空」を分ける。**
    // 日本語が無く英語だけの写真（旧実装で日本語を消した分）は、この画面では
    // 最初から空欄に見える。状態だけで「空なら消す」に倒すと、**タイトルに
    // 触らず場所だけ直した保存で英語が消える**——しかも英語欄が無いので
    // 戻せず、触っていない項目で再ビルド（1回8分）まで走る。
    it("もともと空の写真は、触らなければ送らない", async () => {
        mockAuthFetch.mockImplementation((_url: string, init?: { method?: string }) =>
            Promise.resolve(init?.method === "PUT"
                ? { ok: true, json: async () => ({ success: true }) }
                : {
                    ok: true,
                    json: async () => [{ ...PHOTO, title: { en: "Morning Sea" }, description: { en: ["Old line"] } }],
                }));

        render(<EditPage />);
        const location = await screen.findByDisplayValue("北海道");
        await userEvent.clear(location);
        await userEvent.type(location, "青森");
        await userEvent.click(screen.getByRole("button", { name: /保存|更新/ }));

        await waitFor(() => expect(putBody()).not.toBeNull());
        const body = putBody()!;
        expect("title" in body, "触っていないタイトルを送っている（英語が消える）").toBe(false);
        expect("description" in body, "触っていない説明を送っている").toBe(false);
        expect(body.location).toBe("青森");
    });

    it("日本語が入っていれば、英語は今までどおり残す", async () => {
        render(<EditPage />);
        const title = await screen.findByDisplayValue("海の朝");

        await userEvent.clear(title);
        await userEvent.type(title, "夕暮れ");
        await userEvent.click(screen.getByRole("button", { name: /保存|更新/ }));

        await waitFor(() => expect(putBody()).not.toBeNull());
        expect(putBody()?.title).toEqual({ ja: "夕暮れ", en: "Morning Sea" });
    });
});
