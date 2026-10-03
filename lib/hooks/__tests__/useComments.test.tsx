import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
/** ログイン中に一覧を読む認証つきの口（`GET /user/comments/{id}`）。投稿・削除と分けて数える */
const mockAuthedList = vi.hoisted(() => vi.fn());

// readApiError だけは本物を使う。useComments はサーバーの文言を
// そのまま画面に出すためにこれを通しているので、ここを差し替えると
// 「文言が届くか」を確かめられなくなる（api.ts は Cognito を import
// するだけで、モジュール読み込み時に通信はしない）。
vi.mock("../../utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../utils/api")>("../../utils/api");
    return {
        userFetch: (...a: unknown[]) => String(a[0]).startsWith("/user/comments/")
            ? mockAuthedList(...a)
            : mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
        publicFetch: vi.fn(),
        authenticatedFetch: vi.fn(),
        readApiError: actual.readApiError,
        // 本物を使う（サーバー由来の 404 だけを「もう無い」と読む判定そのもの）
        isGoneResponse: actual.isGoneResponse,
        // 本物を使う（API Gateway の「道が無い」404 だけで未認証の口に戻る判定そのもの）
        isMissingRouteResponse: actual.isMissingRouteResponse,
        // 文言の突き合わせに使う定数。**綴りを書き写さない**
        // （写すと、片方だけ変えたときに気づけない）
        AUTH_REQUIRED_MESSAGE: actual.AUTH_REQUIRED_MESSAGE,
        NETWORK_UNREACHABLE_MESSAGE: actual.NETWORK_UNREACHABLE_MESSAGE,
    };
});

import { useComments } from "../useComments";
import { AUTH_REQUIRED_MESSAGE, NETWORK_UNREACHABLE_MESSAGE } from "../../utils/api";

const comment = (id: string) => ({ id, uid: "u1", name: "旅人", text: "いいね", t: "2026-01-01" });

beforeEach(() => {
    mockUserFetch.mockReset();
    mockUserPublicFetch.mockReset();
    mockAuthedList.mockReset();
});

/** items は表示上の上限（200件）まで、count は本当の総数。読む口2つとも同じ答え */
function mockList(items: ReturnType<typeof comment>[], count: number) {
    mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ items, count }) });
    mockAuthedList.mockResolvedValue({ ok: true, json: async () => ({ items, count }) });
}

/** 404 の応答（`isGoneResponse` / `isMissingRouteResponse` は `clone().json()` を読む） */
const notFound = (body: unknown) => ({
    ok: false, status: 404, json: async () => body, clone: () => ({ json: async () => body }),
});

describe("useComments: 一覧を読む口（S-1）", () => {
    it("ログイン中は認証つきの口で読む（未認証の口は呼ばない）", async () => {
        mockList([comment("c1")], 1);
        const { result } = renderHook(() => useComments("p1", true, 0));
        await waitFor(() => expect(result.current.items).toHaveLength(1));
        expect(mockAuthedList).toHaveBeenCalledTimes(1);
        expect(String(mockAuthedList.mock.calls[0][0])).toBe("/user/comments/p1");
        expect(mockUserPublicFetch).not.toHaveBeenCalled();
    });

    it("未ログインは未認証の口で読む", async () => {
        mockList([comment("c1")], 1);
        const { result } = renderHook(() => useComments("p1", false, 0));
        await waitFor(() => expect(result.current.items).toHaveLength(1));
        expect(String(mockUserPublicFetch.mock.calls[0][0])).toBe("/photos/p1/comments");
        expect(mockAuthedList).not.toHaveBeenCalled();
    });

    // API より Web が先に出た回。API Gateway の定型 404 だけで戻る
    it("認証つきの口が「道が無い」404 なら、未認証の口に戻る", async () => {
        mockList([comment("c1")], 1);
        mockAuthedList.mockResolvedValue(notFound({ message: "Not Found" }));
        const { result } = renderHook(() => useComments("p1", true, 0));
        await waitFor(() => expect(result.current.items).toHaveLength(1));
        expect(result.current.loadError).toBe(false);
        expect(mockUserPublicFetch).toHaveBeenCalledTimes(1);
    });

    // サーバーが断った（見せない相手・無い写真）。戻っても同じ 404 で往復が増えるだけ
    it("サーバーが断った 404 では戻らない（読み込みの失敗として出す）", async () => {
        mockList([comment("c1")], 1);
        mockAuthedList.mockResolvedValue(notFound({ error: "写真が見つかりません" }));
        const { result } = renderHook(() => useComments("p1", true, 0));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.loadError).toBe(true);
        expect(mockUserPublicFetch).not.toHaveBeenCalled();
    });

    it("ログインしたら認証つきの口で読み直す", async () => {
        mockList([comment("c1")], 1);
        const { result, rerender } = renderHook(({ auth }) => useComments("p1", auth, 0), {
            initialProps: { auth: false },
        });
        await waitFor(() => expect(result.current.items).toHaveLength(1));
        rerender({ auth: true });
        await waitFor(() => expect(mockAuthedList).toHaveBeenCalledTimes(1));
    });
});

describe("useComments: 削除の巻き戻し", () => {
    // 別の削除が 404（＝別タブが先に消した）だと reload が走り、手元は
    // サーバーの真値になる。そこへ巻き戻すと食い違いを作る。
    // items にだけガードを置いて count に置かなかった頃、「1件しか無いのに
    // 2件」になっていた。
    it("取り直しが挟まったら巻き戻さない（件数も戻さない）", async () => {
        mockList([comment("c1"), comment("c2")], 2);
        const { result } = renderHook(() => useComments("p1", true, 2));
        await waitFor(() => expect(result.current.items).toHaveLength(2));

        // c1 は落ちる。c2 は 404（別タブが先に消した）→ reload
        let failC1: (e: Error) => void = () => {};
        mockUserFetch.mockImplementation((path: string) =>
            String(path).endsWith("/c1")
                ? new Promise((_, rej) => { failC1 = rej; })
                // isGoneResponse は res.clone().json() を読む（本物を使っている）
                : Promise.resolve({
                    ok: false, status: 404,
                    json: async () => ({ error: "コメントが見つかりません" }),
                    clone: () => ({ json: async () => ({ error: "コメントが見つかりません" }) }),
                }));
        // 取り直しの結果はサーバーの真値（c1 だけ・1件）
        mockList([comment("c1")], 1);

        let p1: Promise<boolean>;
        await act(async () => { p1 = result.current.remove("c1"); await Promise.resolve(); });
        await act(async () => { await result.current.remove("c2"); });
        // 取り直しが着地するまで待つ（件数だけ見ると、楽観削除の途中の 1 と
        // 見分けが付かない）
        await waitFor(() => expect(result.current.items.map((c) => c.id)).toEqual(["c1"]));

        await act(async () => { failC1(new Error("boom")); await p1; });

        expect(result.current.items.map((c) => c.id)).toEqual(["c1"]);
        expect(result.current.count).toBe(1);   // 巻き戻して 2 にしない
    });


    // 削除ボタンは disabled にならないので、通信が遅ければ2件を重ねられる。
    // 配列まるごとの控えに戻していた頃は、**先の1件が失敗**すると、
    // 後の1件（サーバーでは削除済み）が画面に戻り、件数も2つぶん戻った。
    // 再読み込みするまで直らない（失敗時に reload はしない）。
    it("2件を重ねて消し、先の1件が失敗しても、後の1件は戻さない", async () => {
        mockList([comment("c1"), comment("c2"), comment("c3")], 3);
        const { result } = renderHook(() => useComments("p1", true, 3));
        await waitFor(() => expect(result.current.items).toHaveLength(3));

        // c1 の DELETE は落ちる。c2 は成功する
        let failC1: (e: Error) => void = () => {};
        mockUserFetch.mockImplementation((path: string) =>
            String(path).endsWith("/c1")
                ? new Promise((_, rej) => { failC1 = rej; })
                : Promise.resolve({ ok: true, status: 204 }));

        let p1: Promise<boolean>;
        await act(async () => { p1 = result.current.remove("c1"); await Promise.resolve(); });
        await act(async () => { await result.current.remove("c2"); });
        expect(result.current.items.map((c) => c.id)).toEqual(["c3"]);
        expect(result.current.count).toBe(1);

        // ここで c1 が失敗する
        await act(async () => { failC1(new Error("boom")); await p1; });

        // 戻るのは c1 だけ（元の位置に）。c2 は消えたまま、件数も 2
        expect(result.current.items.map((c) => c.id)).toEqual(["c1", "c3"]);
        expect(result.current.count).toBe(2);
    });


    it("失敗したら件数も元に戻す（表示件数にすり替えない）", async () => {
        // 表示は200件でも、本当は250件ある写真。
        // 巻き戻しに items.length を使っていた頃は、削除に失敗した瞬間に
        // ヘッダーの件数が 250 → 200 に化け、再読込まで直らなかった。
        const items = Array.from({ length: 200 }, (_, i) => comment(`c${i}`));
        mockList(items, 250);
        mockUserFetch.mockResolvedValue({ ok: false, status: 500 });

        const { result } = renderHook(() => useComments("p1", true, 250));
        // 件数の初期値は 250 なので、一覧が届くまで待つ
        await waitFor(() => expect(result.current.items).toHaveLength(200));

        let ok = true;
        await act(async () => { ok = await result.current.remove("c0"); });

        expect(ok).toBe(false);
        expect(result.current.count).toBe(250);       // 化けない
        expect(result.current.items).toHaveLength(200); // 消したものが戻る
    });

    it("成功したら件数が1つ減る", async () => {
        mockList([comment("c1"), comment("c2")], 2);
        mockUserFetch.mockResolvedValue({ ok: true });

        const { result } = renderHook(() => useComments("p1", true, 2));
        await waitFor(() => expect(result.current.items).toHaveLength(2));

        await act(async () => { await result.current.remove("c1"); });
        expect(result.current.count).toBe(1);
        expect(result.current.items.map((c) => c.id)).toEqual(["c2"]);
    });

    it("通信そのものが失敗しても巻き戻す", async () => {
        mockList([comment("c1")], 1);
        mockUserFetch.mockRejectedValue(new Error("offline"));

        const { result } = renderHook(() => useComments("p1", true, 1));
        await waitFor(() => expect(result.current.items).toHaveLength(1));

        await act(async () => { await result.current.remove("c1"); });
        expect(result.current.count).toBe(1);
        expect(result.current.items).toHaveLength(1);
    });
});

// 断られた理由は、サーバーが日本語で返している
// （「同じ写真へのコメントは10件までです」など）。
// それを捨てて「投稿に失敗しました」とだけ出していたので、利用者は
// 障害だと思って何度も送り直していた——そのたびにサーバーは写真と
// 200件のコメント文書を読み直す。
//
// 理由は **戻り値** で渡す。state に入れて呼び出し側に読ませると、
// 呼び出し側の関数はその描画時点の値を掴んでいるので、初回は必ず
// 既定文、2回目に1回目の文言、とずれる（実際そうなっていた）。
describe("useComments: 断られた理由", () => {
    const mounted = async () => {
        mockList([], 0);
        const { result } = renderHook(() => useComments("p1", true, 0));
        await waitFor(() => expect(result.current.loading).toBe(false));
        return result;
    };

    it("サーバーの文言をその場で返す（1回目から）", async () => {
        const result = await mounted();
        mockUserFetch.mockResolvedValue({
            ok: false, status: 429,
            json: async () => ({ error: "同じ写真へのコメントは10件までです" }),
        });

        let r: Awaited<ReturnType<typeof result.current.add>> | undefined;
        await act(async () => { r = await result.current.add("もう1件"); });
        expect(r?.status).toBe("error");
        expect(r?.message).toBe("同じ写真へのコメントは10件までです");
    });

    it("文言が無ければ既定文にする", async () => {
        const result = await mounted();
        mockUserFetch.mockResolvedValue({
            ok: false, status: 500, json: async () => { throw new Error("not json"); },
        });

        let r: Awaited<ReturnType<typeof result.current.add>> | undefined;
        await act(async () => { r = await result.current.add("こんにちは"); });
        expect(r?.message).toBe("投稿に失敗しました");
    });

    it("通信そのものが落ちたら、前回の理由を引きずらない", async () => {
        const result = await mounted();
        mockUserFetch.mockResolvedValue({
            ok: false, status: 429, json: async () => ({ error: "同じ写真へのコメントは10件までです" }),
        });
        await act(async () => { await result.current.add("1件目"); });

        mockUserFetch.mockRejectedValue(new Error("offline"));
        let r: Awaited<ReturnType<typeof result.current.add>> | undefined;
        await act(async () => { r = await result.current.add("2件目"); });
        expect(r?.message).toBe("通信に失敗しました");
    });

    it("通ったときは理由を付けない", async () => {
        const result = await mounted();
        mockUserFetch.mockResolvedValue({
            ok: false, status: 429, json: async () => ({ error: "上限です" }),
        });
        await act(async () => { await result.current.add("1件目"); });

        mockUserFetch.mockResolvedValue({
            ok: true, json: async () => ({ comment: comment("c9") }),
        });
        let r: Awaited<ReturnType<typeof result.current.add>> | undefined;
        await act(async () => { r = await result.current.add("2件目"); });
        expect(r).toEqual({ status: "ok" });
        expect(result.current.items.map((c) => c.id)).toEqual(["c9"]);
    });
});

// **セッションが切れているのに「通信に失敗しました」と出していた。**
// catch が理由を無条件で塗り潰すので、回線の問題だと思って何度も押す
// ことになる。`useFollow` は同じ場所で `AUTH_REQUIRED_MESSAGE` を
// 見分けている——対の乖離。
describe("useComments: 投稿の失敗の理由を塗り潰さない", () => {
    it("セッションが切れていたら、そう伝える", async () => {
        mockList([], 0);
        const { result } = renderHook(() => useComments("p1", true, 0));
        await waitFor(() => expect(result.current.loading).toBe(false));

        mockUserFetch.mockRejectedValue(new Error(AUTH_REQUIRED_MESSAGE));
        let r: { status: string; message?: string } | undefined;
        await act(async () => { r = await result.current.add("いいね"); });
        // **既にある `auth-required` の口へ返す。** 画面側はそこで
        // ロケール対応の案内を info で出す（`error` だと素通りして、
        // 日本語固定の定数が赤いトーストで出る）
        expect(r?.status, "既にある案内の導線に乗っていない").toBe("auth-required");
        expect(r?.message, "「通信に失敗しました」で塗り潰している").toBe(AUTH_REQUIRED_MESSAGE);
    });

    // **通信できないだけの回はログインの案内にしない。** 案内どおり
    // ログインし直そうにも、その通信も通らない
    it("通信できないときは、ログインの案内ではなく その理由を返す", async () => {
        mockList([], 0);
        const { result } = renderHook(() => useComments("p1", true, 0));
        await waitFor(() => expect(result.current.loading).toBe(false));

        mockUserFetch.mockRejectedValue(new Error(NETWORK_UNREACHABLE_MESSAGE));
        let r: { status: string; message?: string } | undefined;
        await act(async () => { r = await result.current.add("いいね"); });
        expect(r?.status, "ログインの案内に倒している").toBe("error");
        expect(r?.message).toBe(NETWORK_UNREACHABLE_MESSAGE);
    });

    it("理由の分からない失敗は、今までどおり「通信に失敗しました」", async () => {
        mockList([], 0);
        const { result } = renderHook(() => useComments("p1", true, 0));
        await waitFor(() => expect(result.current.loading).toBe(false));

        mockUserFetch.mockRejectedValue(new TypeError("Failed to fetch"));
        let r: { status: string; message?: string } | undefined;
        await act(async () => { r = await result.current.add("いいね"); });
        expect(r?.message, "英語の技術文字列をそのまま出している").toBe("通信に失敗しました");
    });
});
