import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/** 2026-10-31 束 1: 「さがす」の対象「人」から `/users/search?q=<語>` で来たら、その語で初めから探す */
const asked = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("../../../../lib/hooks/useUserSearch", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/hooks/useUserSearch")>()),
    useUserSearch: (q: string) => { asked.queries.push(q); return { users: [], loading: false, failed: false }; },
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
    useSearchParams: () => new URLSearchParams("q=%E3%81%9F%E3%82%8D%E3%81%86"),
}));
vi.mock("../../../components/FollowButton", () => ({ FollowAction: () => null }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, userId: "me", loading: false }) }));

import UserSearchPage from "../page";

describe("人を探す頁の q", () => {
    it("URL の q を入力欄に入れ、その語で探す", async () => {
        render(<UserSearchPage />);
        await waitFor(() => expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("たろう"));
        expect(asked.queries).toContain("たろう");
    });
});
