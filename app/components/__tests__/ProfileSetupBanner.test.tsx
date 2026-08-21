import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// 「決める」→ プロフィールで名前を保存 → 戻ってくる、と操作しても
// バナーが「名前を決めましょう」のまま残っていた。取得が
// `[isAuthenticated]` の1回きりで、レイアウト常駐なので再マウントされない。
// 未設定と分かっている間だけ、遷移のたびに確かめ直す。

const mockUserFetch = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: mockUserFetch }));

import ProfileSetupBanner from "../ProfileSetupBanner";

const profile = (displayName?: string) => ({ ok: true, json: async () => ({ displayName }) });

beforeEach(() => {
    mockUserFetch.mockReset();
    nav.pathname = "/";
});

describe("名前を設定したらバナーが消える", () => {
    it("保存して戻ってきたら（遷移したら）確かめ直して消す", async () => {
        mockUserFetch.mockResolvedValue(profile(undefined));   // まだ未設定
        const { rerender } = render(<ProfileSetupBanner />);
        expect(await screen.findByText("名前を決めましょう")).toBeInTheDocument();

        // プロフィールで名前を保存してトップへ戻ってきた
        mockUserFetch.mockResolvedValue(profile("旅人"));
        nav.pathname = "/user/profile";
        rerender(<ProfileSetupBanner />);
        nav.pathname = "/";
        rerender(<ProfileSetupBanner />);

        await waitFor(() => expect(screen.queryByText("名前を決めましょう")).toBeNull());
    });

    it("名前を持つ人には、遷移のたびに API を撃たない", async () => {
        mockUserFetch.mockResolvedValue(profile("旅人"));
        const { rerender } = render(<ProfileSetupBanner />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledTimes(1));

        nav.pathname = "/photo/p1";
        rerender(<ProfileSetupBanner />);
        nav.pathname = "/users";
        rerender(<ProfileSetupBanner />);
        await new Promise((r) => setTimeout(r, 20));

        expect(mockUserFetch).toHaveBeenCalledTimes(1);
        expect(screen.queryByText("名前を決めましょう")).toBeNull();
    });

    it("未設定の人には出る（今までの動きを壊していない）", async () => {
        mockUserFetch.mockResolvedValue(profile(""));
        render(<ProfileSetupBanner />);
        expect(await screen.findByText("名前を決めましょう")).toBeInTheDocument();
    });
});
