import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **「この写真を見て撮影」は Web では付けない（アプリが先）。外すだけ**できる
// （`api-user/src/inspired.ts`）。外したら `inspiredBy: null` を送り、触らなければ送らない。

const mockUserFetch = vi.hoisted(() => vi.fn());
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
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const EditPage = (await import("../page")).default;

const base = { id: "p1", src: "https://cdn/p1.jpg", title: "夕焼け", published: true };

function mount(extra: Record<string, unknown>) {
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [{ ...base, ...extra }] });
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    render(<EditPage />);
}

async function savedBody() {
    fireEvent.click(await screen.findByRole("button", { name: "保存する" }));
    await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/photos/p1")).toBe(true));
    const call = mockUserFetch.mock.calls.find((c) => c[0] === "/photos/p1")!;
    return JSON.parse(String((call[1] as { body: string }).body)) as Record<string, unknown>;
}

describe("/user/edit: この写真を見て撮影", () => {
    it("付いていない写真には欄を出さない（Web では付けられない）", async () => {
        mount({});
        await screen.findByDisplayValue("夕焼け");
        expect(screen.queryByTestId("inspired-state")).toBeNull();
        expect(screen.queryByRole("button", { name: "外す" })).toBeNull();
    });

    it("触らなければ送らない", async () => {
        mount({ inspiredBy: "src-1" });
        await screen.findByDisplayValue("夕焼け");
        expect(screen.getByTestId("inspired-state").textContent).toContain("元の写真が付いています");
        expect(await savedBody()).not.toHaveProperty("inspiredBy");
    });

    it("「外す」を押して保存すると null を送る", async () => {
        mount({ inspiredBy: "src-1" });
        fireEvent.click(await screen.findByRole("button", { name: "外す" }));
        expect(screen.getByTestId("inspired-state").textContent).toContain("外します");
        expect(await savedBody()).toHaveProperty("inspiredBy", null);
    });

    it("「元に戻す」で取り消せる（送らない）", async () => {
        mount({ inspiredBy: "src-1" });
        fireEvent.click(await screen.findByRole("button", { name: "外す" }));
        fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
        expect(await savedBody()).not.toHaveProperty("inspiredBy");
    });
});
