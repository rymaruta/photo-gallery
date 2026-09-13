import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * **押した結果を読み上げる**（WCAG 4.1.3 状態メッセージ）。
 *
 * 「見つかりませんでした」も「検索できませんでした」も、入力欄に
 * フォーカスがあるまま**結果の領域だけが差し替わる**形なので、
 * live region が無いと読み上げ環境には何も届かない
 * ——曲検索の失敗（`SongSearchError`）と同じ立場。
 *
 * どちらも `searched`（実際に検索した語がある）が要るので、
 * **開いた瞬間に喋り出すことはない**。
 */
const rows = vi.hoisted(() => ({ users: [] as unknown[], loading: false, failed: false }));
vi.mock("../../../../lib/hooks/useUserSearch", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/hooks/useUserSearch")>()),
    useUserSearch: () => ({ users: rows.users, loading: rows.loading, failed: rows.failed }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock("../../../components/FollowButton", () => ({ FollowAction: () => null }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, userId: "me", loading: false }) }));

import UserSearchPage from "../page";

beforeEach(() => { rows.users = []; rows.loading = false; rows.failed = false; });

const search = (word: string) => {
    render(<UserSearchPage />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: word } });
};

describe("利用者検索の結果の読み上げ", () => {
    it("失敗は alert として届く", () => {
        rows.failed = true;
        search("たろう");
        const el = screen.getByRole("alert");
        expect(el, "失敗が読み上げに届かない").toHaveTextContent("検索できませんでした");
    });

    it("0件は status として届く", () => {
        search("たろう");
        const el = screen.getByRole("status");
        expect(el, "0件が読み上げに届かない").toHaveTextContent("見つかりませんでした");
    });

    // **開いた瞬間には喋らない**（まだ何も検索していない）
    it("検索する前は、どちらも出さない", () => {
        render(<UserSearchPage />);
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.queryByRole("status")).toBeNull();
    });
});
