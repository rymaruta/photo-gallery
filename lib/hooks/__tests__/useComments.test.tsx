import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());

// readApiError だけは本物を使う。useComments はサーバーの文言を
// そのまま画面に出すためにこれを通しているので、ここを差し替えると
// 「文言が届くか」を確かめられなくなる（api.ts は Cognito を import
// するだけで、モジュール読み込み時に通信はしない）。
vi.mock("../../utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../utils/api")>("../../utils/api");
    return {
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
        publicFetch: vi.fn(),
        authenticatedFetch: vi.fn(),
        readApiError: actual.readApiError,
    };
});

import { useComments } from "../useComments";

const comment = (id: string) => ({ id, uid: "u1", name: "旅人", text: "いいね", t: "2026-01-01" });

beforeEach(() => {
    mockUserFetch.mockReset();
    mockUserPublicFetch.mockReset();
});

/** items は表示上の上限（200件）まで、count は本当の総数 */
function mockList(items: ReturnType<typeof comment>[], count: number) {
    mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ items, count }) });
}

describe("useComments: 削除の巻き戻し", () => {
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
describe("useComments: 断られた理由", () => {
    const mounted = async () => {
        mockList([], 0);
        const { result } = renderHook(() => useComments("p1", true, 0));
        await waitFor(() => expect(result.current.loading).toBe(false));
        return result;
    };

    it("サーバーの文言をそのまま持つ", async () => {
        const result = await mounted();
        mockUserFetch.mockResolvedValue({
            ok: false, status: 429,
            json: async () => ({ error: "同じ写真へのコメントは10件までです" }),
        });

        let r = "";
        await act(async () => { r = await result.current.add("もう1件"); });
        expect(r).toBe("error");
        expect(result.current.lastError).toBe("同じ写真へのコメントは10件までです");
    });

    it("文言が無ければ既定文にする", async () => {
        const result = await mounted();
        mockUserFetch.mockResolvedValue({
            ok: false, status: 500, json: async () => { throw new Error("not json"); },
        });

        await act(async () => { await result.current.add("こんにちは"); });
        expect(result.current.lastError).toBe("投稿に失敗しました");
    });

    it("次の投稿が通ったら理由は消える", async () => {
        const result = await mounted();
        mockUserFetch.mockResolvedValue({
            ok: false, status: 429, json: async () => ({ error: "上限です" }),
        });
        await act(async () => { await result.current.add("1件目"); });
        expect(result.current.lastError).toBe("上限です");

        mockUserFetch.mockResolvedValue({
            ok: true, json: async () => ({ comment: comment("c9") }),
        });
        await act(async () => { await result.current.add("2件目"); });
        expect(result.current.lastError).toBeNull();
        expect(result.current.items.map((c) => c.id)).toEqual(["c9"]);
    });
});
