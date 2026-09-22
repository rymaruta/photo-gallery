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

// ブロック一覧は別のテスト（`BlockedUsers.test.tsx`）が見る
vi.mock("../BlockedUsers", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));
vi.mock("../../../components/DeleteAccountModal", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/auth/cognito")>()),
    getCurrentEmail: (...a: unknown[]) => mockGetCurrentEmail(...a),
    startEmailChange: (...a: unknown[]) => mockStartEmailChange(...a),
    confirmEmailChange: (...a: unknown[]) => mockConfirmEmailChange(...a),
}));

const SettingsPage = (await import("../page")).default;

const ok = (data: unknown) => ({ ok: true, json: async () => data });

async function openLoaded() {
    render(<SettingsPage />);
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

    // **この画面はプロフィールを保存しない。**
    //
    // 元はプロフィール編集と同じ画面にあり、「自己紹介を直したらメールまで
    // 送られる」形にしていないことを見張っていた。`/user/settings` へ分けた
    // 2026-09-21 以降は**構造的に起こりえない**——この画面に保存ボタンも
    // プロフィールの PUT も無い。判定をそちらへ言い換える
    it("プロフィールを保存する口を持たない（混ざりようが無い）", async () => {
        await openLoaded();
        await userEvent.type(newEmailBox(), "new@example.com");
        expect(screen.queryByRole("button", { name: /^保存する$/ }),
            "設定にプロフィールの保存ボタンが戻っている").toBeNull();
        expect(screen.queryByLabelText(/表示名/),
            "設定にプロフィールの項目が戻っている").toBeNull();
        // 打っただけでは送らない（ボタンを押すまで何も起きない）
        expect(mockStartEmailChange).not.toHaveBeenCalled();
        expect(mockUserFetch.mock.calls.filter((c) => c[1]?.method === "PUT")).toEqual([]);
    });

    // ⚠️ **自分で踏んだ欠陥。** `getCurrentEmail()` は失敗しても `null` を
    // 返すので、初期値と同じにすると**「読み込み中」のまま永久に止まる**
    it("読めなかったときは「読み込み中」のまま止まらない", async () => {
        mockGetCurrentEmail.mockResolvedValue(null);
        render(<SettingsPage />);
        expect(await screen.findByText(/読み取れませんでした/)).toBeInTheDocument();
        expect(screen.queryByText(/読み込み中/)).toBeNull();
        // **それでも変更はできる**（読めないことと変えられないことは別）
        expect(screen.getByLabelText("新しいメールアドレス")).toBeInTheDocument();
    });

    // **この1本は「守りが効いている」ことは見ていない**（比較先が null なら
    // 空でない文字列は絶対に一致しないので、守りを外しても同じ結果になる。
    // 変異で確かめた）。見ているのは**振る舞い**——いまのアドレスを読めなくても
    // 変更は進められること。`startEmailChange` の呼び出しに `currentEmail` を
    // 要求する形へ変わったら、ここが落ちる
    it("いまのアドレスを読めなくても、変更は進められる", async () => {
        mockGetCurrentEmail.mockResolvedValue(null);
        render(<SettingsPage />);
        await userEvent.type(await screen.findByLabelText("新しいメールアドレス"), "new@example.com");
        await userEvent.click(screen.getByRole("button", { name: /確認コードを送る/ }));
        await waitFor(() => expect(mockStartEmailChange).toHaveBeenCalledWith("new@example.com"));
    });
});
