import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * **ログイン中にパスワードを変えられること。**
 *
 * これが無かった間、変える手段は「ログアウト → `/login` → パスワードを
 * お忘れですか → メールのコード」**だけ**だった——漏洩を疑ったその場で
 * 替えられず、しかも「忘れた」を装う必要があった。
 *
 * **いちばん大事なのは、プロフィールの保存に混ざらないこと。** `handleSave` は
 * プロフィールの項目を PUT するもので、そこにパスワードが乗ると
 * 「自己紹介を直したらパスワードも送られる」形になる。
 */

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();
const mockChangePassword = vi.hoisted(() => vi.fn());

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
// **実物を土台にする。** `PASSWORD_RULE_MESSAGE` を列挙から落とすと、
// 画面に出る規則の文が undefined になって判定が空回りする
vi.mock("../../../../lib/auth/cognito", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/auth/cognito")>()),
    changePassword: (...a: unknown[]) => mockChangePassword(...a),
}));

const SettingsPage = (await import("../page")).default;
const { PASSWORD_RULE_MESSAGE } = await import("../../../../lib/auth/cognito");

const ok = (data: unknown) => ({ ok: true, json: async () => data });

// プロフィールの読み込みはこの画面に無い（`/user/profile` に残っている）。
// 描くだけで、いまのメールアドレスを読む `getCurrentEmail` の解決を待つ
async function openLoaded() {
    render(<SettingsPage />);
    await screen.findByRole("heading", { name: "設定" });
}

const cur = () => screen.getByLabelText("いまのパスワード");
const next = () => screen.getByLabelText("新しいパスワード");
const changeBtn = () => screen.getByRole("button", { name: /パスワードを変更する/ });
const lastToast = () => mockShowToast.mock.calls.at(-1);

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockResolvedValue(ok({}));
    mockChangePassword.mockReset().mockResolvedValue({ success: true });
});

describe("ログイン中にパスワードを変える", () => {
    it("欄が2つあり、空のうちは押せない", async () => {
        await openLoaded();
        expect(changeBtn()).toBeDisabled();
        await userEvent.type(cur(), "Old-pass1");
        // 片方だけではまだ押せない（押しても往復するだけ）
        expect(changeBtn()).toBeDisabled();
        await userEvent.type(next(), "New-pass1");
        expect(changeBtn()).toBeEnabled();
    });

    it("いまのパスワードと新しいパスワードを、その順で渡す", async () => {
        await openLoaded();
        await userEvent.type(cur(), "Old-pass1");
        await userEvent.type(next(), "New-pass1");
        await userEvent.click(changeBtn());
        await waitFor(() => expect(mockChangePassword).toHaveBeenCalledTimes(1));
        // **順番を取り違えると「いまのパスワードが違います」が永久に出る**
        expect(mockChangePassword).toHaveBeenCalledWith("Old-pass1", "New-pass1");
    });

    // **元はここがいちばん怖かった。** プロフィール編集と同じ画面にあった
    // ので、保存に乗ると「自己紹介を直すたびにパスワードが飛ぶ」。
    // `/user/settings` へ分けた 2026-09-21 以降は**構造的に起こりえない**
    // ——この画面に保存ボタンもプロフィールの PUT も無い。
    // 判定を「混ざる余地が戻っていない」へ言い換える
    it("プロフィールを保存する口を持たない（混ざりようが無い）", async () => {
        await openLoaded();
        await userEvent.type(cur(), "Old-pass1");
        await userEvent.type(next(), "New-pass1");

        expect(screen.queryByRole("button", { name: /^保存する$/ }),
            "設定にプロフィールの保存ボタンが戻っている").toBeNull();
        expect(screen.queryByLabelText(/表示名/),
            "設定にプロフィールの項目が戻っている").toBeNull();
        // この画面はプロフィールを一度も書きに行かない
        expect(mockUserFetch.mock.calls.filter((c) => c[1]?.method === "PUT")).toEqual([]);
        // 逆向き: パスワードのボタンを押していないのに変えにいっていない
        expect(mockChangePassword).not.toHaveBeenCalled();
    });

    it("成功したら欄を空にして、他の端末がどうなるかまで言う", async () => {
        await openLoaded();
        await userEvent.type(cur(), "Old-pass1");
        await userEvent.type(next(), "New-pass1");
        await userEvent.click(changeBtn());

        await waitFor(() => expect(lastToast()?.[1]).toBe("success"));
        // **打った中身を画面に残さない**
        expect((cur() as HTMLInputElement).value).toBe("");
        expect((next() as HTMLInputElement).value).toBe("");
        expect(lastToast()?.[0]).toContain("他の端末");
    });

    it("失敗したらサーバーの理由を出し、欄は残す（打ち直させない）", async () => {
        mockChangePassword.mockResolvedValue({ success: false, error: "いまのパスワードが違います" });
        await openLoaded();
        await userEvent.type(cur(), "Wrong-pass1");
        await userEvent.type(next(), "New-pass1");
        await userEvent.click(changeBtn());

        await waitFor(() => expect(lastToast()?.[1]).toBe("error"));
        expect(lastToast()?.[0]).toBe("いまのパスワードが違います");
        expect((next() as HTMLInputElement).value, "失敗したのに打った内容が消えている").toBe("New-pass1");
    });

    // 送る前に断れるものは断る（往復を1回無駄にしない）
    it("8文字未満は送らずに規則を出す", async () => {
        await openLoaded();
        await userEvent.type(cur(), "Old-pass1");
        await userEvent.type(next(), "Ab1!");
        await userEvent.click(changeBtn());

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(lastToast()?.[0]).toBe(PASSWORD_RULE_MESSAGE);
        expect(mockChangePassword, "送る前に断れるのに往復している").not.toHaveBeenCalled();
    });

    it("いまのパスワードと同じなら送らない", async () => {
        await openLoaded();
        await userEvent.type(cur(), "Same-pass1");
        await userEvent.type(next(), "Same-pass1");
        await userEvent.click(changeBtn());

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(lastToast()?.[0]).toContain("同じ");
        expect(mockChangePassword).not.toHaveBeenCalled();
    });
});
