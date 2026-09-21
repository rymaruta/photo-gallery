import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * **押せるのに必ず失敗する形だった。**
 *
 * 画面は `maxLength` で**上限だけ**縛り、**下限3文字を一切見ていなかった**。
 * `ab` のまま保存すると、サーバーは `normalizeUsername` の結果を見て
 * **書き込みの前に** 400 を返す（`api-user/src/userProfile.ts:522`）ので、
 * **同じ保存に乗せた自己紹介・表示名・テーマ色も1件も保存されない**。
 *
 * すぐ隣の曲のリンクは**送る前に**判定して伝えている（`songInvalid`）ので、
 * 対の乖離だった。文言はサーバーと同じものを使う（結果を変えない）。
 *
 * ⚠️ **予約語は写していない。** サーバーだけが持つ一覧で、写すと
 * 静かに古くなる2つ目の表になる。予約語は今までどおりサーバーが断る。
 */
const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));
vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
    AVATAR_MAX_PX: 512, COVER_MAX_PX: 1280,
}));

const ProfilePage = (await import("../page")).default;

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ userId: "u1", username: "", displayName: "", bio: "元の自己紹介" }) });
    mockShowToast.mockReset();
});

/** 保存で飛んだ PUT だけ数える（読み込みの GET を混ぜない） */
const puts = () => mockUserFetch.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === "PUT");

async function open() {
    render(<ProfilePage />);
    await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
    return await screen.findByPlaceholderText("travel_photo") as HTMLInputElement;
}

describe("@名の長さは、送る前に断る", () => {
    it("短すぎる @名で保存しても、送らずに理由を出す", async () => {
        const input = await open();
        fireEvent.change(input, { target: { value: "ab" } });
        await userEvent.click(screen.getByRole("button", { name: "保存する" }));
        expect(puts(), "サーバーへ送っている（必ず 400 で返ってくる往復）").toHaveLength(0);
        expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("3〜20文字"), "error");
    });

    // **正常系**: 規則を満たす @名は今までどおり送る（断りすぎない）
    it("ちょうど下限の @名は送る", async () => {
        const input = await open();
        fireEvent.change(input, { target: { value: "abc" } });
        await userEvent.click(screen.getByRole("button", { name: "保存する" }));
        await waitFor(() => expect(puts(), "正当な @名を止めている").toHaveLength(1));
    });

    // **空は「@名を消す」。** 断ると消す手段が無くなる
    // （サーバーの `normalizeUsername` も空をクリアとして通す）
    it("@名を空にする（消す）のは止めない", async () => {
        mockUserFetch.mockReset().mockImplementation((_u: string, init?: { method?: string }) =>
            Promise.resolve(init?.method === "PUT"
                ? { ok: true, json: async () => ({ success: true }) }
                : { ok: true, json: async () => ({ userId: "u1", username: "traveler", displayName: "", bio: "" }) }));
        const input = await open();
        await waitFor(() => expect(input.value).toBe("traveler"));
        fireEvent.change(input, { target: { value: "" } });
        await userEvent.click(screen.getByRole("button", { name: "保存する" }));
        await waitFor(() => expect(puts(), "@名を消せなくなっている").toHaveLength(1));
    });

    // **予約語はサーバーが断る**（画面に一覧を写さない）
    it("予約語は画面では止めない（サーバーの担当）", async () => {
        const input = await open();
        fireEvent.change(input, { target: { value: "admin" } });
        await userEvent.click(screen.getByRole("button", { name: "保存する" }));
        await waitFor(() => expect(puts(), "予約語の一覧を画面に持ち込んでいる").toHaveLength(1));
    });
});
