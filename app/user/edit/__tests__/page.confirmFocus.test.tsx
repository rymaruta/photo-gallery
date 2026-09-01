import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// 削除確認シートの最初のフォーカス。
// DOM 順の先頭は赤い「削除」で、裏は「保存する」。
// 指名しないと**開いた直後の Enter が削除**になる。
// DeleteConfirmModal（管理画面）側は守られていたが、同じ変更を入れた
// こちらだけ無防備だった。

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

const photo = {
    id: "p1", src: "https://cdn/p1.jpg", title: "夕焼け", description: "",
    location: "", category: "", date: "", tags: [], published: true,
};

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [photo] });
});

describe("/user/edit の削除確認: 最初のフォーカス", () => {
    async function openConfirm() {
        render(<EditPage />);
        const del = await screen.findByRole("button", { name: "削除" });
        fireEvent.click(del);
        return screen.findByRole("dialog");
    }

    it("キャンセル側に入る（赤い「削除」ではなく）", async () => {
        await openConfirm();
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole("button", { name: "キャンセル" }));
        });
    });

    it("確定ボタンには入らない", async () => {
        const dialog = await openConfirm();
        const confirm = Array.from(dialog.querySelectorAll("button"))
            .find((b) => b.textContent?.trim() === "削除");
        expect(confirm).toBeTruthy();
        expect(document.activeElement).not.toBe(confirm);
    });
});
