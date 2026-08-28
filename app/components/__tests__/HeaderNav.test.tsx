import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

// ロールごとの認証状態を切り替えられるモック
const authState = vi.hoisted(() => ({
    current: {
        isAuthenticated: false,
        isAdminUser: false,
        isGeneralUser: false,
        userId: null as string | null,
        loading: false,
        logout: vi.fn(),
    },
}));

vi.mock("../../auth/context", () => ({
    useAuth: () => authState.current,
}));

vi.mock("../../i18n/context", () => ({
    useLocale: () => ({ labels: { navigation: {} } }),
}));

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush }),
}));

import HeaderNav from "../HeaderNav";

function setRole(role: "anonymous" | "general" | "admin") {
    authState.current = {
        isAuthenticated: role !== "anonymous",
        isAdminUser: role === "admin",
        isGeneralUser: role === "general",
        userId: role === "anonymous" ? null : "user-1",
        loading: false,
        logout: vi.fn(),
    };
}

async function openMenu() {
    fireEvent.click(screen.getByLabelText("Open menu"));
}

function menuItems(): string[] {
    return screen.getAllByRole("listitem").map((li) => li.textContent?.trim() ?? "");
}

beforeEach(() => {
    mockPush.mockReset();
});

describe("HeaderNav - ロール別のメニュー表示", () => {
    it("未ログイン: 公開項目とログインのみ（管理・マイページ・アップロードは出ない）", async () => {
        setRole("anonymous");
        render(<HeaderNav />);
        await openMenu();
        const items = menuItems();
        expect(items).toContain("Login");
        expect(items).not.toContain("Manage");
        expect(items).not.toContain("My Page");
        expect(items).not.toContain("Upload");
        expect(items).not.toContain("Logout");
    });

    it("一般ユーザー: マイページ・ログアウトは出るが管理は出ない", async () => {
        setRole("general");
        render(<HeaderNav />);
        await openMenu();
        const items = menuItems();
        expect(items).toContain("My Page");
        expect(items).toContain("Logout");
        expect(items).not.toContain("Manage");
        expect(items).not.toContain("Login");
        // プロフィール編集はマイページ/ヘッダーアバターへ集約したためメニューからは除外
        expect(items).not.toContain("Profile");
        // アップロードはマイページの「写真を追加」に集約したためメニューからは除外
        expect(items).not.toContain("Upload");
    });

    it("管理者: 管理メニューが表示される", async () => {
        setRole("admin");
        render(<HeaderNav />);
        await openMenu();
        expect(menuItems()).toContain("Manage");
    });

    it("マイページは自分の userId のプロフィールURLに遷移する", async () => {
        setRole("general");
        render(<HeaderNav />);
        await openMenu();
        fireEvent.click(screen.getByText("My Page"));
        expect(mockPush).toHaveBeenCalledTimes(1);
        const dest = mockPush.mock.calls[0][0] as string;
        expect(dest === "/users/user-1" || dest === "/users?id=user-1").toBe(true);
    });

    it("メニュー開閉が動作する", async () => {
        setRole("anonymous");
        render(<HeaderNav />);
        expect(screen.queryByRole("dialog")).toBeNull();
        await openMenu();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("ログイン中はヘッダーのアバターからマイページへ直行できる", () => {
        setRole("general");
        render(<HeaderNav />);
        const avatarBtn = screen.getByLabelText("My Page");
        fireEvent.click(avatarBtn);
        expect(mockPush).toHaveBeenCalledTimes(1);
        const dest = mockPush.mock.calls[0][0] as string;
        expect(dest === "/users/user-1" || dest === "/users?id=user-1").toBe(true);
    });

    it("未ログインではヘッダーにアバターを出さない", () => {
        setRole("anonymous");
        render(<HeaderNav />);
        expect(screen.queryByLabelText("My Page")).toBeNull();
    });
});

// メニューが「反応しなくなる」回帰を毎回捕まえるための専用テスト。
// ハンバーガーの開閉・各種クローズ経路・遷移・スクロールロックを網羅する。
describe("HeaderNav - メニュー開閉の回帰ガード", () => {
    beforeEach(() => {
        setRole("general");
        document.body.style.overflow = "";
    });

    it("ハンバーガーで開いて、もう一度押すと閉じる（トグルが効く）", () => {
        render(<HeaderNav />);
        // 初期は閉じている
        expect(screen.getByLabelText("Open menu")).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByRole("dialog")).toBeNull();

        // 開く
        fireEvent.click(screen.getByLabelText("Open menu"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        const closeBtn = screen.getByLabelText("Close menu");
        expect(closeBtn).toHaveAttribute("aria-expanded", "true");

        // 同じボタンで閉じる
        fireEvent.click(closeBtn);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByLabelText("Open menu")).toHaveAttribute("aria-expanded", "false");
    });

    it("背景（バックドロップ）タップで閉じる", () => {
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("Open menu"));
        const dialog = screen.getByRole("dialog");
        // 最初の子要素がバックドロップ
        fireEvent.click(dialog.firstElementChild as Element);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("Escape キーで閉じる", () => {
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("Open menu"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("メニュー項目を押すと遷移し、メニューが閉じる", () => {
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("Open menu"));
        const dialog = screen.getByRole("dialog");
        fireEvent.click(within(dialog).getByText("My Page"));
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("開くと body のスクロールがロックされ、閉じると解除される", () => {
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("Open menu"));
        expect(document.body.style.overflow).toBe("hidden");
        fireEvent.click(screen.getByLabelText("Close menu"));
        expect(document.body.style.overflow).toBe("");
    });

    it("ハンバーガーボタンは常に表示され、ラベルが状態に追従する", () => {
        render(<HeaderNav />);
        const btn = screen.getByLabelText("Open menu");
        expect(btn).toBeInTheDocument();
        fireEvent.click(btn);
        expect(screen.getByLabelText("Close menu")).toBeInTheDocument();
    });
});

// `loading` を受け取っているのに使っておらず、Cognito のセッション確認が
// 終わる前は isAuthenticated が false なので、**ログイン済みの人にも一瞬
// 「ログイン / 新規登録」が並んでいた**。押すとログイン済みのまま
// ログイン画面に飛ぶ。
describe("認証状態が分かるまで", () => {
    it("判定中はログイン/新規登録もログアウトも出さない", () => {
        authState.current = { ...authState.current, isAuthenticated: false, loading: true };
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText(/メニュー|Menu/i));

        expect(screen.queryByRole("button", { name: /Login|ログイン/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Sign up|新規登録/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Logout|ログアウト/ })).toBeNull();
    });

    it("判定が終われば従来どおり出し分ける", () => {
        authState.current = { ...authState.current, isAuthenticated: false, loading: false };
        const { unmount } = render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText(/メニュー|Menu/i));
        expect(screen.getByRole("button", { name: /Login|ログイン/ })).toBeInTheDocument();
        unmount();

        authState.current = { ...authState.current, isAuthenticated: true, loading: false };
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText(/メニュー|Menu/i));
        expect(screen.getByRole("button", { name: /Logout|ログアウト/ })).toBeInTheDocument();
    });
});

// パネルは createPortal(..., document.body) で body の末尾に出るので、
// DOM 順は**ページの一番最後**。開いてから Tab を押すと、フォーカスは
// メニューではなくその下の本文へ進み、トップページなら数十個のリンクと
// フッターを通り抜けないと「マイページ」に届かなかった（＝開いても入れない）。
describe("HeaderNav: 開いたらメニューの中へ入れる", () => {
    it("開くとメニュー内の最初の項目にフォーカスが移る", async () => {
        render(<HeaderNav />);
        const toggle = screen.getByLabelText("Open menu");
        fireEvent.click(toggle);

        const panel = await screen.findByRole("dialog");
        const first = panel.querySelector<HTMLElement>('a[href], button:not([disabled])');
        expect(first).not.toBeNull();
        await waitFor(() => expect(document.activeElement).toBe(first));
    });

    // 戻さないとフォーカスが body に落ち、次の Tab がページ先頭からになる
    it("閉じたら開いたボタンへフォーカスが戻る", async () => {
        render(<HeaderNav />);
        const toggle = screen.getByLabelText("Open menu");
        fireEvent.click(toggle);
        await screen.findByRole("dialog");

        // 開いているときはラベルが変わる
        fireEvent.click(screen.getByLabelText("Close menu"));
        await waitFor(() => expect(document.activeElement).toBe(toggle));
    });
});
