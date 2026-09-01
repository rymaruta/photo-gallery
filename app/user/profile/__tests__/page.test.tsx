import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock("../../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja" }),
}));

vi.mock("../../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

// readApiError と AUTH_REQUIRED_MESSAGE は**本物を使う**。アップロードの
// 失敗経路がサーバーの文言（「対応していない形式です…」）をそのまま出す
// ようになったので、差し替えると何を出しているか確かめられない。
vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return {
        ...actual,
        userFetch: (...args: unknown[]) => mockUserFetch(...args),
    };
});

vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
    AVATAR_MAX_PX: 512,
    COVER_MAX_PX: 1280,
}));

vi.mock("../../../components/DeleteAccountModal", () => ({
    default: () => null,
}));

const ProfilePage = (await import("../page")).default;

const ok = (data: unknown) => ({ ok: true, json: async () => data });

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset();
});

// PUT /user/profile は全置換なので、読み込めていない（＝フォームが空欄の）
// 状態で保存すると、自己紹介・リンク・テーマ色・BGM・ピン留め・旅アルバムが
// まとめて消える。空欄を見たユーザーが「まだ何も設定していない」と誤解して
// 書き直し、保存してしまう経路が実在する。
describe("プロフィール編集: 読み込み失敗時に保存させない", () => {
    it("読み込みに失敗したら警告を出し、保存しても PUT を投げない", async () => {
        mockUserFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
        render(<ProfilePage />);

        // 読み込めなかったことがフォーム上ではっきり分かる
        await screen.findByText(/プロフィールを読み込めませんでした/);

        const save = await screen.findByRole("button", { name: /保存/ });
        await userEvent.click(save);

        // GET の1回だけ。PUT は投げていない
        expect(mockUserFetch).toHaveBeenCalledTimes(1);
        expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("読み込めていません"),
            "error",
        );
    });

    it("ネットワークごと失敗した場合も同じ", async () => {
        mockUserFetch.mockRejectedValueOnce(new Error("offline"));
        render(<ProfilePage />);

        await screen.findByText(/プロフィールを読み込めませんでした/);
        await userEvent.click(await screen.findByRole("button", { name: /保存/ }));

        expect(mockUserFetch).toHaveBeenCalledTimes(1);
    });

    it("読み込みに成功していれば従来どおり保存する", async () => {
        mockUserFetch
            .mockResolvedValueOnce(ok({ userId: "u1", displayName: "旅人", bio: "こんにちは" }))
            .mockResolvedValueOnce(ok({}));
        render(<ProfilePage />);

        await waitFor(() => expect(screen.queryByText(/プロフィールを読み込めませんでした/)).toBeNull());
        // 変えた項目だけ送るようになったので、何か変えてから押す
        // （変更ゼロだと投げない。page.partialSave.test.tsx で固定している）
        const bio = await screen.findByDisplayValue("こんにちは");
        await userEvent.clear(bio);
        await userEvent.type(bio, "旅の記録");
        await userEvent.click(await screen.findByRole("button", { name: /保存/ }));

        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledTimes(2));
        expect(mockUserFetch.mock.calls[1][1]).toMatchObject({ method: "PUT" });
    });
});

// アップロードに失敗してもプレビューが残っていた。画面には新しい写真が
// 出ているのに S3 にもプロフィールにも入っておらず、**保存された気になる**。
// 次に開くと元に戻っていて、何が起きたのか分からない。
describe("プロフィール写真: 失敗したらプレビューを残さない", () => {
    // アバターとカバーは別のハンドラで、同じ間違いを別々にしうる。
    // **両方**を叩く（片方だけだと、もう片方を壊しても通ってしまう）。
    it.each([0, 1])("アップロードに失敗したら、選んだ画像のプレビューを消す（入力 %i）", async (idx) => {
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/user/profile") return Promise.resolve(ok({ displayName: "自分" }));
            return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: "だめでした" }) });
        });
        const { container } = render(<ProfilePage />);
        await screen.findByDisplayValue("自分");

        const fileInputs = container.querySelectorAll('input[type="file"]');
        expect(fileInputs.length).toBeGreaterThan(idx);
        await userEvent.upload(fileInputs[idx] as HTMLInputElement,
            new File(["x"], "pic.jpg", { type: "image/jpeg" }));

        // **サーバーの理由をそのまま出す。** 固定文に潰していた頃は、
        // 「対応していない形式です（JPEG・PNG・…）」なのか一時障害なのか
        // 分からず、同じ画像を選び直していた
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("だめでした", "error"));
        // data: URL のプレビューが残っていない
        await waitFor(() => {
            const imgs = Array.from(container.querySelectorAll("img"));
            expect(imgs.some((i) => i.getAttribute("src")?.startsWith("data:"))).toBe(false);
        });
    });
});
