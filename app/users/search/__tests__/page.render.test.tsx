import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// **結果1行の描画を、4,163件のテストが1つも守っていなかった。**
// `{u.displayName || (u.username ? `@${u.username}` : "ユーザー")}` を
// `{"MUTATED"}` に置き換えてもフルスイートが緑だった（実測）。
//
// ここが決めているのは「**@名を持たない人が、表示名だけで見つけて
// もらえるか**」。本番の2人目がまさにその状態（表示名あり・@名なし）。
const rows = vi.hoisted(() => ({ users: [] as unknown[], loading: false, failed: false }));
// **実物を土台にする。** 列挙だけだと、画面が使う別の export
// （`isSearchableQuery`）が undefined になって落ちる
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

describe("利用者検索の結果1行", () => {
    // **2人目がこの形**（表示名だけ・@名なし）
    it("@名が無くても、表示名で出る", () => {
        rows.users = [{ userId: "u2", displayName: "旅人B" }];
        render(<UserSearchPage />);
        expect(screen.getByText("旅人B"), "表示名だけの人が見つけられない").toBeInTheDocument();
    });

    it("表示名が無ければ @名で出る", () => {
        rows.users = [{ userId: "u3", username: "handle3" }];
        render(<UserSearchPage />);
        expect(screen.getByText("@handle3")).toBeInTheDocument();
    });

    // **どちらも無い人を空行にしない。** 押す対象が無くなる
    it("どちらも無ければ「ユーザー」に落とす", () => {
        rows.users = [{ userId: "u4" }];
        render(<UserSearchPage />);
        expect(screen.getByText("ユーザー")).toBeInTheDocument();
    });

    it("両方あれば、表示名を主に出して @名も添える", () => {
        rows.users = [{ userId: "u5", displayName: "旅人E", username: "handle5" }];
        render(<UserSearchPage />);
        expect(screen.getByText("旅人E")).toBeInTheDocument();
        expect(screen.getByText("@handle5")).toBeInTheDocument();
    });

    it("プロフィールへのリンクになっている", () => {
        rows.users = [{ userId: "u2", displayName: "旅人B" }];
        render(<UserSearchPage />);
        const link = screen.getByRole("link", { name: /旅人B/ });
        expect(link.getAttribute("href")).toContain("u2");
    });
});
