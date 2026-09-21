import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * 設定（⑫）の骨格。
 *
 * ここで固定するのは**「何を置いて、何を置かなかったか」**——owner の
 * 指示「デザインだけ完成して操作できない画面は作らない」を、文章ではなく
 * テストで持つ。モックには在るが実装の無い節（広告・通知の設定・ヘルプ・
 * データとストレージ・アプリについて）を**うっかり足し戻さない**ための
 * 見張りでもある。
 */

const mockShowToast = vi.fn();
const mockReplace = vi.hoisted(() => vi.fn());
const mockAuth = vi.hoisted(() => ({ value: { isAuthenticated: true, loading: false, deleteAccount: vi.fn() } }));

// ブロック一覧は別のテスト（`BlockedUsers.test.tsx`）が見る
vi.mock("../BlockedUsers", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: mockReplace }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => mockAuth.value }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/auth/cognito", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/auth/cognito")>()),
    getCurrentEmail: async () => "me@example.com",
}));

/** 本番の `deploy.yml` が直書きで渡している宛先（`publicEnvWiring.test.ts` が見張る） */
const CONTACT = "journey.photo.official@gmail.com";

beforeEach(() => {
    mockShowToast.mockReset();
    mockReplace.mockReset();
    mockAuth.value = { isAuthenticated: true, loading: false, deleteAccount: vi.fn() };
    vi.resetModules();
});
afterEach(() => { vi.unstubAllEnvs(); });

/**
 * `siteConfig` はモジュール読み込み時に env を読むので、**先に差してから
 * import する**（`app/privacy/__tests__/page.contact.test.tsx` と同じ形）。
 */
async function renderSettings(contactEmail = CONTACT) {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", contactEmail);
    const SettingsPage = (await import("../page")).default;
    render(<SettingsPage />);
}

const open = async (contactEmail = CONTACT) => {
    await renderSettings(contactEmail);
    await screen.findByRole("heading", { name: "設定" });
};

describe("設定の骨格", () => {
    it("アカウント・プライバシー・サポート・危険な操作の4節を出す", async () => {
        await open();
        expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent))
            .toEqual(["アカウント", "プライバシー", "サポート", "危険な操作"]);
    });

    // 🔴 **実装の無い節を置かない**（owner の指示）。
    // モックには在るので、足し戻すときは**機能から**作ること
    it.each([
        ["広告", /広告/, "Web 版に広告の実装が1行も無い（AdMob は iOS の別指示書）"],
        ["通知の設定", /通知/, "何を受け取るかを選ぶ実装が無い"],
        ["ヘルプ", /ヘルプ/, "無い"],
        ["データとストレージ", /データとストレージ|ストレージ/, "操作できる実体が SW の写真キャッシュだけ"],
        ["アプリについて", /アプリについて|バージョン/, "クライアントにバージョン文字列が出ていない"],
    ])("中身の無い節を置かない: %s（%s）", async (_name, pattern) => {
        await open();
        expect(screen.queryByText(pattern), "操作できない項目が並んでいる").toBeNull();
    });

    it("在るものへは繋ぐ（プライバシーポリシー・利用規約・お問い合わせ）", async () => {
        await open();
        const href = (name: string) =>
            screen.getByRole("link", { name: new RegExp(name) }).getAttribute("href");
        expect(href("プライバシーポリシー")).toBe("/privacy");
        expect(href("利用規約")).toBe("/terms");
        // 問い合わせ先は `deploy.yml` が直書きで渡す（`publicEnvWiring.test.ts`）
        expect(href("お問い合わせ")).toMatch(/^mailto:.+@.+/);
    });

    // 逆向き: 宛先が空なら節ごと描かない（押せるのに何も起きない、を作らない）
    it("問い合わせ先が空なら「サポート」を出さない", async () => {
        await open("");
        expect(screen.queryByRole("heading", { name: "サポート" }),
            "宛先が無いのに空の節を並べている").toBeNull();
        expect(document.querySelectorAll('a[href^="mailto:"]')).toHaveLength(0);
        // 他の節は残る
        expect(screen.getByRole("heading", { name: "アカウント" })).toBeInTheDocument();
    });

    // プロフィールの編集項目は**移していない**（あちらに残っている）
    it("プロフィールの編集項目を持ち込んでいない", async () => {
        await open();
        for (const label of [/表示名/, /自己紹介/, /カバー写真/, /マイBGM/, /テーマ/]) {
            expect(screen.queryByText(label), `プロフィールの項目が設定に紛れ込んでいる: ${label}`).toBeNull();
        }
        expect(screen.queryByRole("button", { name: /^保存する$/ })).toBeNull();
    });
});

describe("設定の門", () => {
    it("未ログインならログインへ送る（戻り先を添えて）", async () => {
        mockAuth.value = { isAuthenticated: false, loading: false, deleteAccount: vi.fn() };
        await renderSettings();
        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        expect(String(mockReplace.mock.calls[0][0])).toContain("/login");
    });

    // 🔴 **送り返すまでの間も描かない。** `loading` だけ見ていたので、
    // 未ログインで開くと `router.replace` が効くまでの1描画ぶん、
    // メールアドレス・パスワード・退会の並んだ画面が**丸ごと見えていた**
    // （移設元の `/user/profile` は `loading || fetching` で塞いでいた）
    it("未ログインの間は中身を描かない（送り返すまでの1描画も）", async () => {
        mockAuth.value = { isAuthenticated: false, loading: false, deleteAccount: vi.fn() };
        await renderSettings();

        expect(screen.queryByRole("heading", { name: "アカウント" }),
            "未ログインに設定の中身が見えている").toBeNull();
        expect(screen.queryByLabelText("新しいメールアドレス")).toBeNull();
        expect(screen.queryByRole("button", { name: /退会する/ })).toBeNull();
        // 見出しは読み上げ向けに残す（事前描画で焼かれる枝）
        expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
    });

    it("判定中はまだ送らない（スピナーのまま）", async () => {
        mockAuth.value = { isAuthenticated: false, loading: true, deleteAccount: vi.fn() };
        await renderSettings();
        expect(mockReplace, "認証の確認が終わる前に送り返している").not.toHaveBeenCalled();
    });

    // 🔴 **`useMemberGate` を使わない理由。** あれはグループ（投稿権限）まで
    // 見るので、登録直後の `AdminAddUserToGroup` が落ちた人が弾かれる。
    // その人にもパスワードの変更と退会は要る——むしろ**権限が付かなかった
    // 人ほど退会したい**。`useMemberGate` に差し替えるとここが落ちる
    it("投稿権限が無くても開ける（退会とパスワード変更の口を塞がない）", async () => {
        mockAuth.value = {
            isAuthenticated: true, loading: false, deleteAccount: vi.fn(),
            // グループに1つも入っていない人
            isAdminUser: false, isGeneralUser: false,
        } as typeof mockAuth.value;
        await open();
        expect(screen.getByRole("button", { name: /パスワードを変更する/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /退会する/ })).toBeInTheDocument();
        expect(mockReplace).not.toHaveBeenCalled();
    });
});
