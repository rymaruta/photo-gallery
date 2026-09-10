import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **押せる場所が無かった。** `DELETE /users/{id}/block` と
// `GET /user/blocks` はサーバー側に前からあるのに、呼ぶ画面が0件だった。
// ストーリーの返信からブロックできるようにしたぶん、**誤って押すと
// 元に戻せない**状態を新しく作っていた（ブロックはフォローを両向きに切る）。
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

import BlockedUsers from "../BlockedUsers";

const view = () => render(<BlockedUsers locale="ja" />);
const listOk = (users: unknown) => mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (String(url) === "/user/blocks" && !init?.method) {
        return Promise.resolve({ ok: true, json: async () => ({ users }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
});
const deletes = () => mockUserFetch.mock.calls.filter(
    (c) => String(c[0]).includes("/block") && (c[1] as { method?: string })?.method === "DELETE");

beforeEach(() => { mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) }); });

describe("ブロックした人の一覧と解除", () => {
    it("名前を出し、押すと解除して一覧から消す", async () => {
        listOk([{ id: "u2", name: "しつこい人" }]);
        view();
        await userEvent.click(await screen.findByRole("button", { name: "解除" }));
        await waitFor(() => expect(deletes()).toHaveLength(1));
        expect(deletes()[0][0]).toBe("/users/u2/block");
        await waitFor(() => expect(screen.queryByText("しつこい人")).toBeNull());
    });

    // **効いたときだけ画面から消す。** 失敗を成功に見せると
    // 「解除したのにまだ届かない」で二度目の落胆になる
    it("解除に失敗したら一覧から消さない（押し直せる）", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "DELETE") return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            if (String(url) === "/user/blocks") return Promise.resolve({ ok: true, json: async () => ({ users: [{ id: "u2", name: "しつこい人" }] }) });
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view();
        await userEvent.click(await screen.findByRole("button", { name: "解除" }));
        await waitFor(() => expect(deletes()).toHaveLength(1));
        expect(await screen.findByText("しつこい人"), "効いていないのに消えている").toBeInTheDocument();
        expect(await screen.findByRole("button", { name: "解除" }), "押し直せない").toBeInTheDocument();
    });

    // 普通の人には一生関係の無い節。空なら丸ごと出さない
    it("1人も居なければ何も描かない", async () => {
        listOk([]);
        const { container } = view();
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        expect(container.textContent).toBe("");
    });

    // **「0人」と言い切らない。** 取得できていないだけかもしれない
    it("取得に失敗しても、空の一覧を見せない", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const { container } = view();
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        expect(container.textContent).toBe("");
    });

    // 1件壊れていても画面ごと落とさない（`ErrorBoundary` のカードで
    // 覆われると、解除する手段もろとも消える）
    it("形の壊れた行が混ざっても、残りは出す", async () => {
        listOk([null, { name: "IDが無い" }, { id: "u3" }, "文字列"]);
        view();
        expect(await screen.findByRole("button", { name: "解除" })).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "解除" })).toHaveLength(1);
    });

    // 名前が引けなかった人も解除できないと意味が無い
    it("名前が無くても行は出す", async () => {
        listOk([{ id: "u4" }]);
        view();
        expect(await screen.findByText("旅人")).toBeInTheDocument();
    });
});
