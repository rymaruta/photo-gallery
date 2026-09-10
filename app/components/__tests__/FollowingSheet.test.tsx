import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// owner の指示「誰をフォローしてて、みたいなの見れるようにして」。
// **フォロワー側は出せない**——いまのデータは `following#<uid>` と
// 数（`followstats#`）だけで、「誰にフォローされているか」を引ける行が無い。
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

import FollowingSheet from "../FollowingSheet";

const UID = "11111111-1111-4111-8111-111111111111";
const onClose = vi.fn();
const view = () => render(<FollowingSheet userId={UID} locale="ja" onClose={onClose} />);

const listOk = (users: unknown, total?: number) => mockUserFetch.mockResolvedValue({
    ok: true, json: async () => ({ users, total: total ?? (Array.isArray(users) ? users.length : 0) }),
});

beforeEach(() => { mockUserFetch.mockReset(); onClose.mockReset(); });

describe("フォロー中の一覧", () => {
    it("その人の一覧を引いて、名前とプロフィールへのリンクを出す", async () => {
        listOk([{ id: "u2", name: "旅人B" }]);
        view();
        expect(await screen.findByText("旅人B")).toBeInTheDocument();
        expect(mockUserFetch.mock.calls[0][0]).toBe(`/users/${UID}/following`);
        expect(screen.getByRole("link", { name: /旅人B/ })).toHaveAttribute("href", expect.stringContaining("u2"));
    });

    // **「まだ来ていない」を「0人」と言わない**（台帳 0d）
    it("読み込み中は「まだ誰もフォローしていません」と言わない", async () => {
        mockUserFetch.mockImplementation(() => new Promise(() => { /* 返らない */ }));
        view();
        expect(await screen.findByText("読み込んでいます…")).toBeInTheDocument();
        expect(screen.queryByText("まだ誰もフォローしていません")).toBeNull();
    });

    it("取得に失敗したら、そう言う（0人と混ぜない）", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        view();
        expect(await screen.findByText("一覧を読み込めませんでした")).toBeInTheDocument();
        expect(screen.queryByText("まだ誰もフォローしていません")).toBeNull();
    });

    it("本当に0人なら、そう出す", async () => {
        listOk([]);
        view();
        expect(await screen.findByText("まだ誰もフォローしていません")).toBeInTheDocument();
    });

    // サーバーは50人までしか返さない（1回で2000回の GetItem は撃てない）。
    // **足りないことを黙らない**
    it("全部出せていないときは、その旨を出す", async () => {
        listOk([{ id: "u2", name: "旅人B" }], 60);
        view();
        expect(await screen.findByText(/60 人のうち、はじめの 1 人/)).toBeInTheDocument();
    });

    it("全部出せているときは、その一文を出さない", async () => {
        listOk([{ id: "u2", name: "旅人B" }]);
        view();
        await screen.findByText("旅人B");
        expect(screen.queryByText(/はじめの/)).toBeNull();
    });

    // 1件壊れていても画面ごと落とさない
    it("形の壊れた行が混ざっても、残りは出す", async () => {
        listOk([null, { name: "IDが無い" }, { id: "u3" }, "文字列"], 4);
        view();
        expect(await screen.findByText("旅人")).toBeInTheDocument();
        expect(screen.getAllByRole("link")).toHaveLength(1);
    });

    it("Escape と閉じるボタンで閉じる", async () => {
        listOk([]);
        view();
        await userEvent.click(await screen.findByLabelText("閉じる"));
        expect(onClose).toHaveBeenCalled();
        onClose.mockReset();
        await userEvent.keyboard("{Escape}");
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});
