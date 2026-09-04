import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **「送る項目についてだけ言う」にテストが無かった。**
//
// `changedFields` は変えた項目しか送らないので、説明を触っていない保存で
// 「超えた分は保存されません」と出すのは嘘になる——タイトルだけ直しても、
// 非公開ボタンを押しても**毎回**出ていた（`11309be` で直した）。
// ところがその修正を戻す変異（`"description" in changed ? … : undefined` を
// `nextDescription` に戻す）を当てても、テストは全部緑のままだった
// ——`describeOverLimit` を純粋関数として呼ぶテストと、ソースを正規表現で
// 見るテストしか無く、**保存ハンドラを動かすテストが1本も無かった**。
// 「守りを足したのにテストが無い」を3回続けている。

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
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const EditPage = (await import("../page")).default;

// 2000字を超える説明を**既に持っている**写真。
// この状態でタイトルだけ直しても、説明は送られない
const LONG = "あ".repeat(2500);
// タグも**既に上限を超えている**状態にしておく（触らなければ送らない）
const MANY_TAGS = Array.from({ length: 35 }, (_, i) => `t${i}`);
const photo = {
    id: "p1", src: "https://cdn/p1.jpg", title: "夕焼け", description: LONG,
    location: "", category: "", date: "", tags: MANY_TAGS, published: true,
};

const OVER = /超えた分は保存されません/;
const warned = () => mockShowToast.mock.calls.some((c) => OVER.test(String(c[0])));

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [photo] });
});

async function openAndSave() {
    render(<EditPage />);
    await screen.findByDisplayValue("夕焼け");
    mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(mockUserFetch.mock.calls.length).toBeGreaterThan(1));
}

/** 保存で送った body */
function savedBody(): Record<string, unknown> {
    const call = mockUserFetch.mock.calls.find((c) => String(c[1]?.method ?? "").toUpperCase() !== "GET" && c[1]?.body);
    expect(call, "保存のリクエストが飛んでいない").toBeDefined();
    return JSON.parse(String(call![1].body)) as Record<string, unknown>;
}

describe("/user/edit: 上限の警告は、送る項目についてだけ", () => {
    it("説明を触っていなければ、既に長くても言わない", async () => {
        await openAndSave();
        expect(savedBody(), "触っていない説明を送っている").not.toHaveProperty("description");
        expect(warned(), "送っていない項目について「超えた分は保存されません」と言っている").toBe(false);
    });

    it("タグを触っていなければ、既に多くても言わない", async () => {
        await openAndSave();
        expect(savedBody(), "触っていないタグを送っている").not.toHaveProperty("tags");
        expect(warned()).toBe(false);
    });

    it("タグを増やして編集したら言う", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("夕焼け");
        const tagInput = screen.getByDisplayValue(MANY_TAGS.join(", "));
        fireEvent.change(tagInput, { target: { value: [...MANY_TAGS, "追加"].join(", ") } });

        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        fireEvent.click(screen.getByRole("button", { name: "保存する" }));
        await waitFor(() => expect(warned()).toBe(true));
        expect(savedBody()).toHaveProperty("tags");
    });

    it("説明を長いまま編集したら言う", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("夕焼け");
        const textarea = document.querySelector("textarea")!;
        fireEvent.change(textarea, { target: { value: `${LONG}追記` } });

        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        fireEvent.click(screen.getByRole("button", { name: "保存する" }));
        await waitFor(() => expect(warned()).toBe(true));
        expect(savedBody()).toHaveProperty("description");
    });

    // 正常系: 短くすれば言わない（言い続けると、直しても叱られる）
    it("2000字以内に直したら言わない", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("夕焼け");
        fireEvent.change(document.querySelector("textarea")!, { target: { value: "短い説明" } });

        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        fireEvent.click(screen.getByRole("button", { name: "保存する" }));
        await waitFor(() => expect(mockUserFetch.mock.calls.length).toBeGreaterThan(1));
        expect(warned()).toBe(false);
    });
});
