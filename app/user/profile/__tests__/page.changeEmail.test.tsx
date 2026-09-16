import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * **メールアドレスを変えられること。**
 *
 * このプールは `AliasAttributes: ["email"]`＝**メールがログインID**。
 * 変える手段が無かった間、メールを変えた人・失った人は**退会して作り直す
 * 以外に無く**、写真・いいね・フォロワー・共有したURLが全部消えていた。
 *
 * **2段にする理由**: 新しいアドレスに確認コードを送り、そのコードで確定する。
 * 確定するまで古いアドレスでログインできる（プールの
 * `AttributesRequireVerificationBeforeUpdate` が効いている。本番に入って
 * いることは `diagnose` で実測した）。コードを入れる前にやめた人を
 * 締め出さないための形なので、**段が飛ばないこと**を見る。
 */

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();
const mockGetCurrentEmail = vi.hoisted(() => vi.fn());
const mockStartEmailChange = vi.hoisted(() => vi.fn());
const mockConfirmEmailChange = vi.hoisted(() => vi.fn());

vi.mock("../BlockedUsers", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));
vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error { },
    AVATAR_MAX_PX: 512,
    COVER_MAX_PX: 1280,
}));
vi.mock("../../../components/DeleteAccountModal", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/auth/cognito")>()),
    getCurrentEmail: (...a: unknown[]) => mockGetCurrentEmail(...a),
    startEmailChange: (...a: unknown[]) => mockStartEmailChange(...a),
    confirmEmailChange: (...a: unknown[]) => mockConfirmEmailChange(...a),
}));

const ProfilePage = (await import("../page")).default;

const ok = (data: unknown) => ({ ok: true, json: async () => data });
const STORED = { userId: "u1", username: "tabibito", displayName: "旅人", bio: "こんにちは" };

async function openLoaded() {
    mockUserFetch.mockResolvedValueOnce(ok(STORED)).mockResolvedValueOnce(ok({}));
    render(<ProfilePage />);
    await screen.findByDisplayValue("旅人");
    // 現在のメールが届くまで待つ（この節の判定はここが出てから）
    await screen.findByText("old@example.com");
}

const newEmailBox = () => screen.getByLabelText("新しいメールアドレス");
const sendBtn = () => screen.getByRole("button", { name: /確認コードを送る/ });
const lastToast = () => mockShowToast.mock.calls.at(-1);

/** 1段目を通して、コード入力の段まで進める */
async function reachCodeStep(addr = "new@example.com") {
    await openLoaded();
    await userEvent.type(newEmailBox(), addr);
    await userEvent.click(sendBtn());
    return screen.findByLabelText(`${addr} に送ったコード`);
}

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockResolvedValue(ok({}));
    mockGetCurrentEmail.mockReset().mockResolvedValue("old@example.com");
    mockStartEmailChange.mockReset().mockResolvedValue({ success: true });
    mockConfirmEmailChange.mockReset().mockResolvedValue({ success: true });
});

describe("メールアドレスを変える", () => {
    it("いま登録されているアドレスを出す（何から変えるのか分かる）", async () => {
        await openLoaded();
        expect(screen.getByText("old@example.com")).toBeInTheDocument();
    });

    it("空のうちは送れない", async () => {
        await openLoaded();
        expect(sendBtn()).toBeDisabled();
        await userEvent.type(newEmailBox(), "new@example.com");
        expect(sendBtn()).toBeEnabled();
    });

    it("押すと新しいアドレスにコードを送り、コード入力の段へ進む", async () => {
        await reachCodeStep();
        expect(mockStartEmailChange).toHaveBeenCalledWith("new@example.com");
        // **どこに届いたかを言い続ける**（欄を書き換えられても分かるように）
        expect(screen.getByLabelText("new@example.com に送ったコード")).toBeInTheDocument();
        expect(lastToast()?.[0]).toContain("いまのアドレスでログインできます");
    });

    // **段が飛ばないこと。** 送れていないのにコードの段へ進むと、
    // 届かないコードを待つ画面で詰まる
    it("送るのに失敗したら、コードの段へ進まない", async () => {
        mockStartEmailChange.mockResolvedValue({ success: false, error: "そのメールアドレスは使えません。別のアドレスをお試しください" });
        await openLoaded();
        await userEvent.type(newEmailBox(), "taken@example.com");
        await userEvent.click(sendBtn());

        await waitFor(() => expect(lastToast()?.[1]).toBe("error"));
        expect(lastToast()?.[0]).toContain("使えません");
        expect(screen.queryByLabelText(/に送ったコード/), "送れていないのにコードの段へ進んでいる").toBeNull();
        // 打った内容は残す（打ち直させない）
        expect((newEmailBox() as HTMLInputElement).value).toBe("taken@example.com");
    });

    it("いまのアドレスと同じなら送らない", async () => {
        await openLoaded();
        await userEvent.type(newEmailBox(), "old@example.com");
        await userEvent.click(sendBtn());

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(lastToast()?.[0]).toContain("同じ");
        expect(mockStartEmailChange, "送る前に断れるのに往復している").not.toHaveBeenCalled();
    });

    it("コードで確定すると、ログインに使うアドレスが新しい方になる", async () => {
        const code = await reachCodeStep();
        await userEvent.type(code, "123456");
        await userEvent.click(screen.getByRole("button", { name: /メールアドレスを変更する/ }));

        await waitFor(() => expect(mockConfirmEmailChange).toHaveBeenCalledWith("123456"));
        await waitFor(() => expect(lastToast()?.[1]).toBe("success"));
        // **トークンは古いままなので読み直さない。** 自分が知っている新しい値を出す
        expect(await screen.findByText("new@example.com")).toBeInTheDocument();
        expect(screen.queryByText("old@example.com")).toBeNull();
        expect(mockGetCurrentEmail, "変えたあとにトークンを読み直している（古い値に戻る）").toHaveBeenCalledTimes(1);
    });

    it("コードが違えば段に留まり、理由を出す", async () => {
        mockConfirmEmailChange.mockResolvedValue({ success: false, error: "確認コードが違います" });
        const code = await reachCodeStep();
        await userEvent.type(code, "000000");
        await userEvent.click(screen.getByRole("button", { name: /メールアドレスを変更する/ }));

        await waitFor(() => expect(lastToast()?.[1]).toBe("error"));
        expect(lastToast()?.[0]).toBe("確認コードが違います");
        expect(screen.getByLabelText("new@example.com に送ったコード")).toBeInTheDocument();
        expect(screen.getByText("old@example.com"), "確定していないのにアドレスが入れ替わっている").toBeInTheDocument();
    });

    // **やめる道を残す。** コードが届かない人がここで詰まると設定画面から出るしか無い
    it("やめると1段目に戻れる", async () => {
        await reachCodeStep();
        await userEvent.click(screen.getByRole("button", { name: /やめる/ }));
        expect(await screen.findByLabelText("新しいメールアドレス")).toBeInTheDocument();
        expect(screen.queryByLabelText(/に送ったコード/)).toBeNull();
    });

    // プロフィールの保存とは別の口（パスワードと同じ理由）
    it("プロフィールの保存ではメールを変えにいかない", async () => {
        await openLoaded();
        await userEvent.type(newEmailBox(), "new@example.com");
        await userEvent.clear(screen.getByDisplayValue("旅人"));
        await userEvent.type(screen.getByLabelText(/表示名/), "旅人2");
        await userEvent.click(screen.getByRole("button", { name: /^保存する$/ }));

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(mockStartEmailChange).not.toHaveBeenCalled();
        const puts = mockUserFetch.mock.calls.filter((c) => c[1]?.method === "PUT");
        expect(JSON.stringify(puts.at(-1)?.[1]?.body ?? "")).not.toContain("new@example.com");
    });
});
