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
vi.mock("../../../../lib/utils/api", () => ({ authenticatedFetch: mockAuthFetch }));

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
