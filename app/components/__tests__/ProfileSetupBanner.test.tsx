import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// 「決める」→ プロフィールで名前を保存 → 戻ってくる、と操作しても
// バナーが「名前を決めましょう」のまま残っていた。取得が
// `[isAuthenticated]` の1回きりで、レイアウト常駐なので再マウントされない。
// 未設定と分かっている間だけ、遷移のたびに確かめ直す。

const mockUserFetch = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({ pathname: "/" }));
const auth = vi.hoisted(() => ({ isAuthenticated: true, userId: "user-a" as string | null }));

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ ...auth }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: mockUserFetch }));

import ProfileSetupBanner from "../ProfileSetupBanner";

const profile = (displayName?: string) => ({ ok: true, json: async () => ({ displayName }) });

beforeEach(() => {
    mockUserFetch.mockReset();
    nav.pathname = "/";
    auth.isAuthenticated = true;
    auth.userId = "user-a";
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

// 判定をアカウントをまたいで持ち越していた（B-2 で入れた回帰）。
// レイアウト常駐なのでログアウト（クライアント遷移）ではアンマウントされない。
describe("アカウントを切り替えたら判定を持ち越さない", () => {
    it("名前ありA→ログアウト→名前なしBで、Bにバナーが出る", async () => {
        mockUserFetch.mockResolvedValue(profile("旅人A"));
        const { rerender } = render(<ProfileSetupBanner />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledTimes(1));
        expect(screen.queryByText("名前を決めましょう")).toBeNull();

        // ログアウト → 名前なしの B がログイン
        auth.isAuthenticated = false;
        auth.userId = null;
        rerender(<ProfileSetupBanner />);
        mockUserFetch.mockResolvedValue(profile(undefined));
        auth.isAuthenticated = true;
        auth.userId = "user-b";
        rerender(<ProfileSetupBanner />);

        // B について確かめ直して、バナーが出る
        expect(await screen.findByText("名前を決めましょう")).toBeInTheDocument();
    });

    it("名前なしA→ログアウトで、バナーがその場で消える（Bに誤表示しない）", async () => {
        mockUserFetch.mockResolvedValue(profile(undefined));
        const { rerender } = render(<ProfileSetupBanner />);
        expect(await screen.findByText("名前を決めましょう")).toBeInTheDocument();

        auth.isAuthenticated = false;
        auth.userId = null;
        rerender(<ProfileSetupBanner />);
        expect(screen.queryByText("名前を決めましょう")).toBeNull();

        // 名前ありの B がログインしてもバナーは出ない
        mockUserFetch.mockResolvedValue(profile("旅人B"));
        auth.isAuthenticated = true;
        auth.userId = "user-b";
        rerender(<ProfileSetupBanner />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledTimes(2));
        expect(screen.queryByText("名前を決めましょう")).toBeNull();
    });
});

// 上の2本は「フェッチ解決後」しか見ておらず、表示条件から userId の
// 一致を外す変異が素通りした（実測）。切替直後・確認前の過渡状態で
// 前の人の判定が使われないことを、フェッチを未解決のまま観測して固定する。
describe("切替直後・確認前に前の人の判定で描かない", () => {
    it("名前なしAのバナーは、Bの確認が終わるまで（未解決の間）出ない", async () => {
        mockUserFetch.mockResolvedValue(profile(undefined));
        const { rerender } = render(<ProfileSetupBanner />);
        expect(await screen.findByText("名前を決めましょう")).toBeInTheDocument();

        // ログアウト → B がログイン。B のプロフィール取得は**まだ返さない**
        auth.isAuthenticated = false;
        auth.userId = null;
        rerender(<ProfileSetupBanner />);
        let resolveB!: (v: unknown) => void;
        mockUserFetch.mockReturnValue(new Promise((r) => { resolveB = r; }));
        auth.isAuthenticated = true;
        auth.userId = "user-b";
        rerender(<ProfileSetupBanner />);

        // 確認前。A の判定（needsName=true）で描いてはいけない
        expect(screen.queryByText("名前を決めましょう")).toBeNull();

        resolveB(profile("旅人B"));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledTimes(2));
        expect(screen.queryByText("名前を決めましょう")).toBeNull();
    });
});
