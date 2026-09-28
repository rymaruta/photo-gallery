import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 「親しい友達」（iOS の CloseFriendsView と同じ）。API は前からあったのに、
// Web には呼ぶ画面が無かった。選ぶのはフォロー中の人から、保存は押したときに差分だけ。
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    userPublicFetch: (...a: unknown[]) => mockPublicFetch(...a),
}));

import CloseFriends from "../CloseFriends";

const ok = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
function serve(closeIds: string[], following: unknown[], write: (url: string, method: string) => boolean = () => true, total?: number, listed?: number) {
    mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
        const u = String(url);
        const m = init?.method;
        if (u === "/user/close-friends" && !m) return ok({ userIds: closeIds });
        if (u === "/users/me/following" && !m) return ok({ users: following, total: total ?? following.length, ...(listed !== undefined ? { listed } : {}) });
        if (m === "PUT" || m === "DELETE") {
            return write(u, m) ? ok({ success: true }) : Promise.resolve({ ok: false, json: async () => ({ error: "だめ" }) });
        }
        return ok({});
    });
}
const writes = () => mockUserFetch.mock.calls
    .filter((c) => ["PUT", "DELETE"].includes((c[1] as { method?: string })?.method ?? ""))
    .map((c) => `${(c[1] as { method: string }).method} ${c[0]}`);
const view = () => render(<CloseFriends locale="ja" userId="me" />);
const star = (name: string) => screen.findByRole("switch", { name: `${name} を親しい友達にする` });

beforeEach(() => {
    mockUserFetch.mockReset();
    mockPublicFetch.mockReset().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
});

describe("親しい友達", () => {
    it("フォロー中の人を並べ、選んである人は星が付いている", async () => {
        serve(["u1"], [{ id: "u1", name: "山田" }, { id: "u2", name: "佐藤" }]);
        view();
        expect(await star("山田")).toHaveAttribute("aria-checked", "true");
        expect(await star("佐藤")).toHaveAttribute("aria-checked", "false");
        expect(screen.getByText("選んだ人 1")).toBeInTheDocument();
    });

    it("星を押しただけでは送らない。保存で差分だけを1人ずつ送る", async () => {
        serve(["u1"], [{ id: "u1", name: "山田" }, { id: "u2", name: "佐藤" }]);
        view();
        const save = await screen.findByRole("button", { name: "保存" });
        expect(save, "変えていないのに保存できる").toBeDisabled();
        await userEvent.click(await star("山田"));   // 外す
        await userEvent.click(await star("佐藤"));   // 入れる
        expect(writes(), "押しただけで送っている").toEqual([]);
        await userEvent.click(save);
        await waitFor(() => expect(writes()).toEqual(["DELETE /user/close-friends/u1", "PUT /user/close-friends/u2"]));
        expect(await screen.findByText("保存しました")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "保存" }), "保存したのにまだ押せる").toBeDisabled();
    });

    it("途中で断られたら理由を出し、残りはもう一度押せば続きから送る", async () => {
        let failU3 = true;
        serve([], [{ id: "u2", name: "佐藤" }, { id: "u3", name: "鈴木" }],
            (url) => !(url.endsWith("/u3") && failU3));
        view();
        await userEvent.click(await star("佐藤"));
        await userEvent.click(await star("鈴木"));
        await userEvent.click(screen.getByRole("button", { name: "保存" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("だめ");
        failU3 = false;
        mockUserFetch.mock.calls.length = 0;
        await userEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(writes(), "効いた分まで送り直している").toEqual(["PUT /user/close-friends/u3"]));
    });

    /**
     * **退会の印はフォロー一覧の `deleted: true` だけ。** 公開プロフィールは退会した人にも
     * 名前の無い人にも同じ 200 `{ userId }` を返すので、そちらでは分からない
     * （最初「404＝退会」と書いたが、本番では一度も当たらない判定だった）
     */
    it("上の一覧に出ない人も外せる。名前は公開プロフィールから引き、退会はフォロー一覧の印で出す", async () => {
        serve(["gone", "dead"], [{ id: "u2", name: "佐藤" }, { id: "dead", deleted: true }]);
        mockPublicFetch.mockImplementation((url: string) => {
            if (String(url) === "/profile/gone") return ok({ displayName: "古い友達", username: "old" });
            return ok({ userId: "x" });   // 本番の「未設定・退会」の応答
        });
        view();
        expect(await screen.findByText("上の一覧に出ない人")).toBeInTheDocument();
        // **「フォローを外した人」と決めつけない**（まだフォロー中の古い人も来る）
        expect(screen.getByText(/上の一覧に入りきらない人/)).toBeInTheDocument();
        expect(await star("退会した人")).toHaveAttribute("aria-checked", "true");
        expect(mockPublicFetch.mock.calls.map((c) => String(c[0])), "退会と分かっている人まで引いた").toEqual(["/profile/gone"]);
        await userEvent.click(await star("古い友達"));
        await userEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(writes()).toEqual(["DELETE /user/close-friends/gone"]));
    });

    /** 一覧は新しい順に50人まで（`follow.ts` の FOLLOWING_PAGE）。黙って切らない */
    it("フォロー中が一覧に入りきらない（50人で切れた）ときは、そう伝える", async () => {
        const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, name: `人${i}` }));
        serve([], fifty, () => true, 80);
        view();
        expect(await screen.findByText("フォロー中 80人のうち、新しい 50人を表示しています。")).toBeInTheDocument();
    });

    /** 見える人がちょうど50人（ブロック関係の人が総数にだけ入っている）なら、切れてはいない */
    it("見える人がちょうど50人なら、切れていないので言わない（listed で見る）", async () => {
        const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, name: `人${i}` }));
        serve([], fifty, () => true, 53, 50);
        view();
        await star("人0");
        expect(screen.queryByText(/人を表示しています/)).toBeNull();
    });

    it("listed が行より多ければ、切れているので言う", async () => {
        const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, name: `人${i}` }));
        serve([], fifty, () => true, 80, 78);
        view();
        expect(await screen.findByText("フォロー中 80人のうち、新しい 50人を表示しています。")).toBeInTheDocument();
    });

    /** 総数は退会した人・ブロック関係の人も数えるので、切れていないのにずれる */
    it("総数とずれていても、50人に届いていなければ「新しい何人」とは言わない", async () => {
        serve([], [{ id: "u1", name: "山田" }], () => true, 3);
        view();
        await star("山田");
        expect(screen.queryByText(/人を表示しています/)).toBeNull();
    });

    it("入りきるときは注記を出さない", async () => {
        serve([], [{ id: "u1", name: "山田" }]);
        view();
        await star("山田");
        expect(screen.queryByText(/人を表示しています/)).toBeNull();
    });

    it("名前の無い人は @ユーザー名で出し、ユーザー名でも絞り込める", async () => {
        serve([], [{ id: "u1", name: "山田" }, { id: "u3", username: "tabibito" }]);
        view();
        expect(await star("@tabibito")).toBeInTheDocument();
        await userEvent.type(screen.getByPlaceholderText("名前で探す"), "tabi");
        expect(screen.queryByRole("switch", { name: "山田 を親しい友達にする" })).toBeNull();
        expect(screen.getByRole("switch", { name: "@tabibito を親しい友達にする" })).toBeInTheDocument();
    });

    it("名前で絞り込める", async () => {
        serve([], [{ id: "u1", name: "山田" }, { id: "u2", name: "佐藤" }]);
        view();
        await star("山田");
        await userEvent.type(screen.getByPlaceholderText("名前で探す"), "佐");
        expect(screen.queryByRole("switch", { name: "山田 を親しい友達にする" })).toBeNull();
        expect(screen.getByRole("switch", { name: "佐藤 を親しい友達にする" })).toBeInTheDocument();
    });

    it("読み込めなかったら0人と区別して伝える", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
        view();
        expect(await screen.findByRole("alert")).toHaveTextContent("読み込めませんでした");
        expect(screen.queryByText(/フォローしている人がまだいません/)).toBeNull();
    });

    it("誰もフォローしていなければ、そう伝える", async () => {
        serve([], []);
        view();
        expect(await screen.findByText(/フォローしている人がまだいません/)).toBeInTheDocument();
    });
});
