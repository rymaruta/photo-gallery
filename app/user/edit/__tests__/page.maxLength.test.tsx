import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// サーバーは超えた分を**黙って切る**（`sanitizeText` / `sanitizeTitle`）。
// 上限を告げる文言も入力の制限も無かったので、保存は成功したように見えて、
// あとで開くと末尾が無い。サーバーと同じ数字を入れる。
//
// **説明とタグには入れない。** 説明はサーバーが段落ごとに 2000 で切る
// （最大50段落）ので欄全体に 2000 を入れると「サーバーは受け付けるのに
// 入力できない」になる。タグはカンマ区切りの1入力で、上限はタグ1つあたり。

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

describe("/user/edit: サーバーの上限を入力にも入れる", () => {
    it.each([
        ["タイトル", "200"],
        ["場所", "200"],
        ["カテゴリ", "100"],
    ])("%s は maxLength=%s", async (label, max) => {
        render(<EditPage />);
        const el = await screen.findByLabelText(label).catch(() => null)
            ?? await waitFor(() => {
                const found = screen.getByText(label).parentElement?.querySelector("input");
                expect(found).not.toBeNull();
                return found!;
            });
        expect(el.getAttribute("maxlength")).toBe(max);
    });

    // 段落ごとの上限なので、欄全体に入れてはいけない
    it("説明には maxLength を入れない（段落ごとの上限なので）", async () => {
        const { container } = render(<EditPage />);
        await screen.findByDisplayValue("夕焼け");
        const textarea = container.querySelector("textarea");
        expect(textarea).not.toBeNull();
        expect(textarea!.getAttribute("maxlength")).toBeNull();
    });
});
