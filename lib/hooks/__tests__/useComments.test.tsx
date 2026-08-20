import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());

vi.mock("../../utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    publicFetch: vi.fn(),
    authenticatedFetch: vi.fn(),
}));

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
