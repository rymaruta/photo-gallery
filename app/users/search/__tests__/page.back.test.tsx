import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// **戻るボタンがサイトの外へ出ていた。**
//
// `router.back()` を直に呼んでいたので、共有リンクやブックマークで
// この画面を直接開いた場合、戻る先は「前に見ていた別のサイト」になる。
// ユーザーから見ると、サイト内の矢印を押したのにサイトから出る。

const mockBack = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ back: mockBack, push: mockPush }),
    useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, userId: "me", loading: false }),
}));
vi.mock("../../../../lib/utils/api", () => ({
    userPublicFetch: vi.fn(async () => ({ ok: true, json: async () => ({ users: [] }) })),
    publicFetch: vi.fn(async () => ({ ok: true, json: async () => ({ users: [] }) })),
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    readApiError: async () => "エラー",
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const SearchPage = (await import("../page")).default;

/** `history.length` は読み取り専用なので、その場だけ差し替える */
function withHistoryLength(n: number, run: () => void) {
    const desc = Object.getOwnPropertyDescriptor(window.history, "length");
    Object.defineProperty(window.history, "length", { value: n, configurable: true });
    try { run(); } finally {
        if (desc) Object.defineProperty(window.history, "length", desc);
        else delete (window.history as unknown as Record<string, unknown>).length;
    }
}

beforeEach(() => {
    mockBack.mockReset();
    mockPush.mockReset();
});

describe("ユーザー検索の戻るボタン", () => {
    it("このタブの最初の1画面なら、トップへ送る（サイトの外へ出さない）", () => {
        withHistoryLength(1, () => {
            render(<SearchPage />);
            fireEvent.click(screen.getByLabelText("戻る"));
        });
        expect(mockBack, "戻り先が無いのに back() を呼んでいる").not.toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith("/");
    });

    it("サイト内から来ていれば、これまでどおり戻る", () => {
        withHistoryLength(3, () => {
            render(<SearchPage />);
            fireEvent.click(screen.getByLabelText("戻る"));
        });
        expect(mockBack).toHaveBeenCalledTimes(1);
        expect(mockPush, "前の画面に戻れるのにトップへ飛ばしている").not.toHaveBeenCalled();
    });
});
