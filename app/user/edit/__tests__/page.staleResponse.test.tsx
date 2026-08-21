import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// /admin/edit に入れた中断ガードが、同じ形の /user/edit には無かった。
// 遅い回線で下書き A を開いて戻り B を開くと、A の応答が後から届いて
// フォームが A の内容で埋まる。save() は現在の photoId（= B）を送るので、
// **B の写真に A のタイトル・説明・タグ・撮影日が上書き保存される**。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ id: "A" as string | null }));

const stableRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
vi.mock("next/navigation", () => ({
    useRouter: () => stableRouter,
    useSearchParams: () => ({ get: (k: string) => (k === "id" ? q.id : null) }),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({ userFetch: mockUserFetch }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const EditPage = (await import("../page")).default;

const photo = (id: string, title: string) => ({
    id, src: `https://cdn/${id}.jpg`, title, description: `${id}の説明`,
    location: `${id}の場所`, category: "風景", date: "2024-10-12T00:00:00.000Z",
    tags: [`${id}タグ`], published: false,
});
const ALL = [photo("A", "Aのタイトル"), photo("B", "Bのタイトル")];

function deferred() {
    let resolve!: (v: unknown) => void;
    const promise = new Promise<unknown>((r) => { resolve = r; });
    return { promise, resolve };
}

// 応答は「何回目の呼び出しか」ではなく「呼ばれた時点の ?id」で決める
const holds = new Map<string, ReturnType<typeof deferred>>();

beforeEach(() => {
    mockShowToast.mockReset();
    holds.clear();
    q.id = "A";
    mockUserFetch.mockReset().mockImplementation((_url: string, init?: { method?: string }) => {
        if (init?.method === "PUT" || init?.method === "PATCH" || init?.method === "POST") {
            return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        }
        const held = q.id ? holds.get(q.id) : undefined;
        if (held) return held.promise;
        return Promise.resolve({ ok: true, json: async () => ALL });
    });
});

describe("/user/edit: 遅れて届いた別の写真の応答", () => {
    it("切り替えたあとに届いた古い応答でフォームを埋めない", async () => {
        const slowA = deferred();
        holds.set("A", slowA);

        const { rerender } = render(<EditPage />);
        // A の取得が動的 import を終えて fetch を掴むところまで進める
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        q.id = "B";
        rerender(<EditPage />);
        await screen.findByDisplayValue("Bのタイトル");

        // ここで A の応答がようやく届く
        slowA.resolve({ ok: true, json: async () => ALL });
        await new Promise((r) => setTimeout(r, 0));

        expect(screen.getByDisplayValue("Bのタイトル")).toBeTruthy();
        expect(screen.queryByDisplayValue("Aのタイトル")).toBeNull();
        expect(screen.queryByDisplayValue("Aの場所")).toBeNull();
    });

    it("普通に開けば内容が入る（今までの動きを壊していない）", async () => {
        render(<EditPage />);
        expect(await screen.findByDisplayValue("Aのタイトル")).toBeTruthy();
        expect(screen.getByDisplayValue("Aの場所")).toBeTruthy();
    });
});
