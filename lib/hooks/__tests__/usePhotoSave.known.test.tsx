import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/**
 * `known`（一覧から分かっている保存の有無）。
 *
 * ホームのカードは `useMySaves` で**一覧ぶんを1回で**引き、写真ごとに
 * `GET /user/saves/<id>` を撃たない。ここが崩れると、一覧を開くだけで
 * N 往復になる（いいねを「数と行き先だけ」にしたのと同じ理由）。
 */
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

import { usePhotoSave } from "../usePhotoSave";

const ok = (body: unknown) => ({ ok: true, json: async () => body });

beforeEach(() => { mockUserFetch.mockReset(); mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }); });
afterEach(() => vi.clearAllMocks());

describe("usePhotoSave: 一覧から分かっているとき（known）", () => {
    it("🔴 known が渡されたら、写真ごとに聞きに行かない", () => {
        const { result } = renderHook(() => usePhotoSave("p1", true, false, true));
        expect(result.current.saved).toBe(true);
        expect(mockUserFetch, "一覧で分かっているのに GET を撃った").not.toHaveBeenCalled();
    });

    it("known=false は未保存。undefined なら今までどおり聞きに行く", async () => {
        const { result } = renderHook(() => usePhotoSave("p1", true, false, false));
        expect(result.current.saved).toBe(false);
        expect(mockUserFetch).not.toHaveBeenCalled();
        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        const later = renderHook(() => usePhotoSave("p2", true, false, undefined));
        await waitFor(() => expect(later.result.current.saved).toBe(true));
        expect(mockUserFetch).toHaveBeenCalledWith("/user/saves/p2", expect.anything());
    });

    it("一覧が後から届いたら（undefined → true）それに合わせる", () => {
        const { result, rerender } = renderHook(({ k }: { k?: boolean }) => usePhotoSave("p1", true, false, k), { initialProps: { k: undefined as boolean | undefined } });
        expect(result.current.saved).toBe(false);
        rerender({ k: true });
        expect(result.current.saved).toBe(true);
    });

    it("🔴 押したあとは、遅れて届いた一覧の値で戻さない", async () => {
        // 一覧はまだ（undefined）→ 押す → 押す前の姿の一覧（false）が遅れて届く。
        // **最初から false を渡して false を渡し直す形では効果が観測できない**
        // （値が変わらないので effect が走らない。変異 M2 が素通りして気づいた）
        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        const { result, rerender } = renderHook(({ k }: { k?: boolean }) => usePhotoSave("p1", true, false, k), { initialProps: { k: undefined as boolean | undefined } });
        await act(async () => { await result.current.toggle(); });
        expect(result.current.saved).toBe(true);
        rerender({ k: false });   // 古い一覧（押す前の姿）が遅れて届いた
        expect(result.current.saved, "押した結果を一覧で巻き戻した").toBe(true);
    });

    it("写真が変わったら、新しい写真の known で出直す", () => {
        const { result, rerender } = renderHook(({ id, k }: { id: string; k: boolean }) => usePhotoSave(id, true, false, k), { initialProps: { id: "p1", k: true } });
        expect(result.current.saved).toBe(true);
        rerender({ id: "p2", k: false });
        expect(result.current.saved).toBe(false);
        expect(mockUserFetch).not.toHaveBeenCalled();
    });
});
