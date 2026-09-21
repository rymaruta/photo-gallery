import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **押せる場所が無かった。** `DELETE /users/{id}/block` と
// `GET /user/blocks` はサーバー側に前からあるのに、呼ぶ画面が0件だった。
// ストーリーの返信からブロックできるようにしたぶん、**誤って押すと
// 元に戻せない**状態を新しく作っていた（ブロックはフォローを両向きに切る）。
const mockUserFetch = vi.hoisted(() => vi.fn());
// **実物を土台にする。** 列挙だけだと、実装が新しく使い始めた export
// （`readApiError` / `sessionErrorMessage`）が undefined になり、
// 呼んだ瞬間に vitest が投げる——それを画面の `catch` が飲むので
// **緑のまま何も出ない**（台帳が何度も踏んでいる形）
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
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
    // **解除の失敗を無言にしない。**
    // `if (res.ok)` だけで、失敗時にトーストも文言も出していなかった
    // ——ボタンが戻って行が残るだけなので、効かなかったのか・まだなのか・
    // 押し方が悪いのかが分からない。**ここはブロック解除の唯一の口**で、
    // `StoryViewer` と `UserProfileClient` が「解除は設定の『ブロックした人』から」と
    // 案内する到達先。同じファイルの取得失敗は文言で伝えているのに、
    // ここだけ黙っていた
    it("解除に失敗したら、その理由を出す", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "DELETE") {
                return Promise.resolve({
                    ok: false, status: 500,
                    clone: () => ({ json: async () => ({}) }),
                    json: async () => ({}),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({ users: [{ id: "u2", name: "しつこい人" }] }) });
        });
        view();
        await userEvent.click(await screen.findByRole("button", { name: "解除" }));
        await waitFor(() => expect(deletes()).toHaveLength(1));

        expect(await screen.findByRole("alert"), "押しても何も起きないように見える").toBeInTheDocument();
        // 効いていないので行は残す（押し直せる）
        expect(screen.getByText("しつこい人")).toBeInTheDocument();
    });

    it("通信ごと落ちても理由を出す", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "DELETE") return Promise.reject(new Error("offline"));
            return Promise.resolve({ ok: true, json: async () => ({ users: [{ id: "u2", name: "しつこい人" }] }) });
        });
        view();
        await userEvent.click(await screen.findByRole("button", { name: "解除" }));
        await waitFor(() => expect(deletes()).toHaveLength(1));
        expect(await screen.findByRole("alert")).toBeInTheDocument();
    });

    // **成功した回に理由を出さない**（押すたびに赤い1行が残らないこと）
    it("解除できたら、理由は出さない", async () => {
        listOk([{ id: "u2", name: "しつこい人" }]);
        view();
        await userEvent.click(await screen.findByRole("button", { name: "解除" }));
        await waitFor(() => expect(screen.queryByText("しつこい人")).toBeNull());
        expect(screen.queryByRole("alert"), "成功したのに理由を出している").toBeNull();
    });

    it("1人も居なければ何も描かない", async () => {
        listOk([]);
        const { container } = view();
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        expect(container.textContent).toBe("");
    });

    // **「0人」と言い切らない。** 取得できていないだけかもしれない。
    // 黙って消すと、ストーリーの返信欄が案内している先が
    // **何も無い行き止まり**になる（解除の口はここしかない）
    it("取得に失敗したら、空の一覧ではなく読み込めなかったと出す", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        view();
        expect(await screen.findByText(/読み込めませんでした/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "解除" }), "空の一覧を見せている").toBeNull();
    });

    it("通信ごと落ちても同じ", async () => {
        mockUserFetch.mockRejectedValue(new Error("offline"));
        view();
        expect(await screen.findByText(/読み込めませんでした/)).toBeInTheDocument();
    });

    // API を先に出す運用なのでふつうは起きないが、順序に依存させる理由が無い
    it("古い応答（IDだけ）でも一覧を出す", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url) === "/user/blocks" && !init?.method) {
                return Promise.resolve({ ok: true, json: async () => ({ blockedIds: ["u9"] }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view();
        expect(await screen.findByRole("button", { name: "解除" })).toBeInTheDocument();
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
    // **退会した人を「旅人」として並べない。**
    // 名前が引けないのは「未設定の人」も「退会した人」も同じなので、
    // フォールバックに落ちると**生きている人に見える**。
    // サーバー側（`listBlocks`）を直しても、ここが `deleted` を読んで
    // いなければ**日本語固定の名前をそのまま出すだけ**だった
    // **`deleted` で決める。`name` に頼らない。**
    // 最初はフィクスチャの `name` を「退会したユーザー」にしていたので、
    // **画面の変更を戻しても通った**（サーバーが日本語を返すから出ていた
    // だけ）。名前を別の文字列にして、画面が `deleted` を読んでいることを
    // 見る——サーバーの文言に依存しないのがこの修正の目的
    it("退会した人は、名前ではなく `deleted` で判断して伏せる", async () => {
        listOk([{ id: "u2", name: "退会前の名前", deleted: true }]);
        view();
        expect(await screen.findByText("退会したユーザー")).toBeInTheDocument();
        expect(screen.queryByText("退会前の名前"), "退会した人の名前を出している").toBeNull();
        expect(screen.queryByText("旅人"), "退会した人を「旅人」として並べている").toBeNull();
    });

    // **サーバーの文言をそのまま出さない。** `DELETED_USER_NAME` は
    // 日本語固定なので、素通しだと英語表示の人にも日本語が出る
    //（`FollowingSheet` は `deleted` を見て "Deleted user" を出している）
    it("英語表示では英語で出す", async () => {
        listOk([{ id: "u2", name: "退会前の名前", deleted: true }]);
        render(<BlockedUsers locale="en" />);
        expect(await screen.findByText("Deleted user")).toBeInTheDocument();
        expect(screen.queryByText("退会したユーザー"), "英語UIに日本語が出ている").toBeNull();
    });

    // **解除は押せるままにする。** 押せないと外せなくなる
    // （相手が退会していても、こちらの `blocks#` の行は残る）
    it("退会した人でも解除できる", async () => {
        listOk([{ id: "u2", name: "退会前の名前", deleted: true }]);
        view();
        await userEvent.click(await screen.findByRole("button", { name: "解除" }));
        await waitFor(() => expect(deletes()).toHaveLength(1));
        expect(deletes()[0][0]).toBe("/users/u2/block");
    });

    it("名前が無くても行は出す", async () => {
        listOk([{ id: "u4" }]);
        view();
        expect(await screen.findByText("旅人")).toBeInTheDocument();
    });
});
