import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * **コメントの入力欄を画面の下に貼る**（2026-10-21・iOS の写真の詳細と同じ）。
 *
 * - 入力欄は一覧の**後ろ**に置き、`sticky` で下に留める（上に置いたままの sticky は下に貼り付かない）
 * - 留める高さは下の案内（`BottomNav`）の実寸 `--bottom-bar-h` のすぐ上——案内と重ならない
 * - ログインしていない人にも同じ場所に「ログインしてコメント」（当たり 44・戻り先つき）
 */
const auth = vi.hoisted(() => ({ value: { isAuthenticated: false, userId: null as string | null, loading: false } }));
const mockUserPublicFetch = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../lib/utils/api")>("../../../lib/utils/api");
    return {
        ...actual,
        userFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
        publicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    };
});
vi.mock("../../auth/context", () => ({ useAuth: () => auth.value }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../UserAvatar", () => ({ default: () => <div /> }));

import CommentSection from "../CommentSection";

beforeEach(() => {
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [{ id: "c1", uid: "u1", name: "旅人", text: "きれい", t: "2026-10-01T00:00:00Z" }], count: 1 }),
    });
    auth.value = { isAuthenticated: false, userId: null, loading: false };
});

describe("コメントの入力欄（下に貼る）", () => {
    it("ログインしていない人には「ログインしてコメント」を下の案内のすぐ上に貼る", async () => {
        window.history.replaceState(null, "", "/photo/p1");
        render(<CommentSection photoId="p1" locale="ja" hideHeading />);
        await screen.findByText("きれい");
        const bar = screen.getByTestId("comment-composer");
        expect(bar.className).toContain("sticky");
        expect(bar.style.bottom).toContain("--bottom-bar-h");
        // 一覧の後ろ（sticky の bottom は、上に置くと貼り付かない）
        const list = screen.getByText("きれい").closest("ul")!;
        expect(list.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const login = screen.getByTestId("comment-login");
        expect(login.textContent).toBe("ログインしてコメント");
        expect(login.getAttribute("href")).toContain("next=");
        expect(login.style.minHeight).toBe("44px");
    });

    it("ログインしている人は入力欄と送信が下に貼られる（44 の高さ）", async () => {
        auth.value = { isAuthenticated: true, userId: "me", loading: false };
        render(<CommentSection photoId="p1" locale="ja" hideHeading />);
        await waitFor(() => expect(screen.getByText("きれい")).toBeTruthy());
        const bar = screen.getByTestId("comment-composer");
        const box = bar.querySelector("textarea")!;
        expect(box.style.minHeight).toBe("44px");
        expect(box.getAttribute("aria-label")).toBe("コメント");
        expect(screen.getByRole("button", { name: "送信" }).style.minHeight).toBe("44px");
        expect(screen.queryByTestId("comment-login")).toBeNull();
    });
});
