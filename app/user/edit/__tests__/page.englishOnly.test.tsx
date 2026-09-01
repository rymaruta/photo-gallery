import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// **英語しか無い写真を開くと、日本語欄に英語が入る。**
//
// `titleToText` は `ja || en` なので、日本語が無ければ英語を出す。そのまま
// 保存すると英語がそのまま日本語タイトルとして定着する——本人は「元から
// こう入っていた」としか思わない。欄を空にすると中身が画面から見えなく
// なり（英語を消す手段はどこにも無い）、逆向きの問題になるので、
// **見せたうえで注記する**方に倒した。

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

const base = {
    id: "p1", src: "https://cdn/p1.jpg", location: "", category: "", date: "", tags: [], published: true,
};

const load = (photo: Record<string, unknown>) => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [photo] });
    return render(<EditPage />);
};

beforeEach(() => { mockUserFetch.mockReset(); });

describe("/user/edit: 英語しか無い項目には注記を出す", () => {
    it("英語だけのタイトルなら、英語が見えたうえで注記が出る", async () => {
        load({ ...base, title: { en: "Sunset over the lake" }, description: "" });
        expect(await screen.findByDisplayValue("Sunset over the lake")).toBeInTheDocument();
        expect(screen.getByText(/英語のタイトルしか持っていません/), "注記が無いまま英語が日本語欄に入っている").toBeInTheDocument();
    });

    it("英語だけの説明にも注記が出る", async () => {
        load({ ...base, title: "夕焼け", description: { en: ["A quiet evening."] } });
        expect(await screen.findByDisplayValue("A quiet evening.")).toBeInTheDocument();
        expect(screen.getByText(/英語の説明しか持っていません/)).toBeInTheDocument();
    });

    // 正常系: 日本語がある写真では出さない（英語を併せ持っていても）
    it("日本語があるなら注記は出さない", async () => {
        load({ ...base, title: { ja: "夕焼け", en: "Sunset" }, description: { ja: ["静かな夕方。"], en: ["A quiet evening."] } });
        expect(await screen.findByDisplayValue("夕焼け")).toBeInTheDocument();
        expect(screen.queryByText(/しか持っていません/), "日本語があるのに注記が出ている").toBeNull();
    });

    // 欄には空白が入る（`titleToText` は `o.ja || o.en` で空白を採用する）。
    // ここで「英語しか持っていません」と出すのは事実と違う
    it("空白だけの日本語でも、英語しか無いとは言わない", async () => {
        const { container } = load({ ...base, title: { ja: "   ", en: "Sunset" }, description: "" });
        // `findByDisplayValue` は空白を正規化してしまうので、値は直接見る
        await screen.findByText("タイトル");
        const input = container.querySelector('input[type="text"]') as HTMLInputElement;
        expect(input.value, "英語の方を入れている").toBe("   ");
        expect(screen.queryByText(/しか持っていません/), "欄の中身と注記が食い違っている").toBeNull();
    });

    it("文字列そのままのタイトルでも出さない", async () => {
        load({ ...base, title: "夕焼け", description: "" });
        expect(await screen.findByDisplayValue("夕焼け")).toBeInTheDocument();
        expect(screen.queryByText(/しか持っていません/)).toBeNull();
    });
});
