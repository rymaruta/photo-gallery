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

/**
 * 🔴 **`known` は「一覧が返ってから」しか効かない。**
 *
 * `useMySaves` が飛行中のあいだ `savedIds` は `null` ＝ `known` は
 * `undefined` なので、**カードは全部それぞれ GET を撃っていた**。
 * 上の `known` のテストは「返ったあと」だけを見ていたので、
 * **この穴は一度も落ちなかった**。
 *
 * 実測（2026-09-22・ログイン済みでホームを1回開く。実ブラウザ）:
 *
 *     GET /user/saves/<id>   ×33   ← 写真ごと
 *     GET /user/saves        ×1    ← 一括（最後に着地）
 *
 * ⚠️ **Lambda の同時実行はアカウント全体で 10**（`CLAUDE.md`）。
 * 1人がホームを開くだけで上限を大きく超える要求が出る。
 */
describe("usePhotoSave: 一覧をいま引いている最中（knownPending）", () => {
    it("🔴 一覧が飛行中なら、写真ごとに聞きに行かない", () => {
        renderHook(() => usePhotoSave("p1", true, false, undefined, true));
        expect(mockUserFetch, "一覧の到着を待たずに GET を撃った").not.toHaveBeenCalled();
    });

    it("一覧が返ったら、その値を使う（それでも GET は撃たない）", async () => {
        const { result, rerender } = renderHook(
            ({ known, pending }: { known?: boolean; pending: boolean }) =>
                usePhotoSave("p1", true, false, known, pending),
            { initialProps: { known: undefined as boolean | undefined, pending: true } },
        );
        expect(mockUserFetch).not.toHaveBeenCalled();
        rerender({ known: true, pending: false });
        await waitFor(() => expect(result.current.saved).toBe(true));
        expect(mockUserFetch, "一覧が返ったあとに GET を撃った").not.toHaveBeenCalled();
    });

    /**
     * **一覧が失敗したら、今までどおり聞きに行く。** 塞ぐのは
     * 「待てば分かる」窓だけで、経路そのものは消さない
     * （消すと、一覧が落ちた人のしおりが永久に未保存に見える）
     */
    it("一覧が失敗したら（pending が下りて known も無い）聞きに行く", async () => {
        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        const { result, rerender } = renderHook(
            ({ pending }: { pending: boolean }) => usePhotoSave("p1", true, false, undefined, pending),
            { initialProps: { pending: true } },
        );
        expect(mockUserFetch).not.toHaveBeenCalled();
        rerender({ pending: false });
        await waitFor(() => expect(result.current.saved).toBe(true));
        expect(mockUserFetch).toHaveBeenCalledWith("/user/saves/p1", expect.anything());
    });

    // **既定は今までどおり**（写真ページ・ビューアは一覧を持たないので聞きに行く）
    it("渡さなければ今までどおり聞きに行く", async () => {
        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        const { result } = renderHook(() => usePhotoSave("p1", true));
        await waitFor(() => expect(result.current.saved).toBe(true));
        expect(mockUserFetch).toHaveBeenCalledWith("/user/saves/p1", expect.anything());
    });
});
