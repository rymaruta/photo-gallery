import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AUTH_REQUIRED_MESSAGE, NETWORK_UNREACHABLE_MESSAGE } from "../../../../lib/utils/api";

// **押し直しても直らない失敗は、そう伝える。**
// 9か所に散っていた見分けを `sessionErrorMessage` に寄せたが、
// 呼び出しが繋がっているかは大半が無検証だった——`sessionErrorMessage(e)` を
// `null` に固定する変異で、この画面の保存は素通りした。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return { ...actual, userFetch: mockUserFetch };
});
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const EditPage = (await import("../page")).default;

const photo = { id: "p1", src: "https://cdn/p1.jpg", title: "夕焼け", location: "江ノ島", published: true };

beforeEach(() => { mockShowToast.mockReset(); mockUserFetch.mockReset(); });

async function saveWith(err: Error) {
    mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
        if (init?.method === "PUT") return Promise.reject(err);
        if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [photo] });
        return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(<EditPage />);
    // 何か直してから保存する（触っていないと送る項目が無い）
    fireEvent.change(await screen.findByDisplayValue("夕焼け"), { target: { value: "夕焼けの色" } });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    return String(mockShowToast.mock.calls[0][0]);
}

describe("/user/edit の保存: 押し直しても直らない失敗", () => {
    it("セッションが切れていたら、そう伝える", async () => {
        expect(await saveWith(new Error(AUTH_REQUIRED_MESSAGE))).toBe(AUTH_REQUIRED_MESSAGE);
    });

    it("通信できないときは、ログインの話をしない", async () => {
        expect(await saveWith(new Error(NETWORK_UNREACHABLE_MESSAGE))).toBe(NETWORK_UNREACHABLE_MESSAGE);
    });

    it("理由の分からない失敗は、今までどおりの文言", async () => {
        expect(await saveWith(new TypeError("Failed to fetch"))).toBe("保存に失敗しました");
    });
});
