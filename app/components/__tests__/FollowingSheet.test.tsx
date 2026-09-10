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
const view = (kind: "following" | "followers" = "following") =>
    render(<FollowingSheet userId={UID} kind={kind} locale="ja" onClose={onClose} />);

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

    // **`document` で聞かないと、パネルの文字をタップした時点で効かなくなる。**
    // React の合成イベントはフォーカスがパネルの中にあるときしか届かない
    it("フォーカスが外れていても Escape で閉じる", async () => {
        listOk([]);
        view();
        await screen.findByText("まだ誰もフォローしていません");
        (document.activeElement as HTMLElement | null)?.blur();
        expect(document.activeElement).toBe(document.body);
        await userEvent.keyboard("{Escape}");
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    // 退会した人は開いても空のページ。退会が消すのは本人の `following#`
    // だけなので、他人の一覧には残り続ける
    it("退会した人はリンクにしない", async () => {
        listOk([{ id: "gone", deleted: true }, { id: "u2", name: "旅人B" }]);
        view();
        expect(await screen.findByText("退会したユーザー")).toBeInTheDocument();
        expect(screen.getAllByRole("link"), "空のページへ飛ばしている").toHaveLength(1);
        expect(screen.queryByText("旅人"), "「旅人」という普通の行として出している").toBeNull();
    });

    // **配列でなければ「取れなかった」**。`[]` に潰すと「0人」と混ざる
    it("users が配列でなければ、0人ではなく失敗として出す", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ users: { broken: true }, total: 5 }) });
        view();
        expect(await screen.findByText("一覧を読み込めませんでした")).toBeInTheDocument();
        expect(screen.queryByText("まだ誰もフォローしていません")).toBeNull();
        expect(screen.queryByText(/はじめの/), "0人と件数を同時に出している").toBeNull();
    });
});

// **モーダルとしての作法**。他のモーダルには専用のテストがあるのに
// （`GalleryModalFocus` / `StoryFocus` / `StoriesBar.focus`）、ここだけ
// 無かった——`useFocusTrap` も `lockBodyScroll` も背景クリックも、
// 消して全件緑になる状態だった（変異で実測）
describe("フォロー中の一覧: モーダルとしての作法", () => {
    it("開いたら中にフォーカスを移す（外へ漏らさない）", async () => {
        listOk([{ id: "u2", name: "旅人B" }]);
        view();
        const panel = await screen.findByRole("dialog");
        await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    });

    it("開いている間は背景をスクロールさせない", async () => {
        listOk([]);
        const { unmount } = view();
        await screen.findByRole("dialog");
        expect(document.body.style.position, "背景が一緒に動く").toBe("fixed");
        unmount();
        expect(document.body.style.position, "閉じても固まったまま").toBe("");
    });

    it("背景を押したら閉じる", async () => {
        listOk([]);
        view();
        await screen.findByRole("dialog");
        await userEvent.click(document.querySelector(".fixed.inset-0") as HTMLElement);
        expect(onClose).toHaveBeenCalled();
    });

    it("中を押しても閉じない", async () => {
        listOk([]);
        view();
        await userEvent.click(await screen.findByRole("dialog"));
        expect(onClose, "中を触っただけで閉じる").not.toHaveBeenCalled();
    });

    it("名前を押したら閉じる（開いたまま裏で遷移させない）", async () => {
        listOk([{ id: "u2", name: "旅人B" }]);
        view();
        await userEvent.click(await screen.findByText("旅人B"));
        expect(onClose).toHaveBeenCalled();
    });
});

// **1つの部品で両方出す。** 違うのは口と見出しだけで、倒し方は同じ。
// 分けて書くと静かにずれる
describe("フォロワーの一覧（同じ部品）", () => {
    it("フォロワー側の口を叩き、見出しも変える", async () => {
        listOk([{ id: "u2", name: "旅人B" }]);
        view("followers");
        await screen.findByText("旅人B");
        expect(mockUserFetch.mock.calls[0][0]).toBe(`/users/${UID}/followers`);
        expect(screen.getByRole("dialog", { name: "フォロワー" })).toBeInTheDocument();
    });

    it("0人のときの文言もフォロワー向けにする", async () => {
        listOk([]);
        view("followers");
        expect(await screen.findByText("まだフォロワーはいません")).toBeInTheDocument();
    });
});
