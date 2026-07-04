import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

    it("一般ユーザー: マイページ・アップロード・プロフィールは出るが管理は出ない", async () => {
        setRole("general");
        render(<HeaderNav />);
        await openMenu();
        const items = menuItems();
        expect(items).toContain("My Page");
        expect(items).toContain("Upload");
        expect(items).toContain("Profile");
        expect(items).toContain("Logout");
        expect(items).not.toContain("Manage");
        expect(items).not.toContain("Login");
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
});
