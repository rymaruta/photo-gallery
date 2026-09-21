import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// **前の写真の応答が着地しても、いまの写真の番人は下りない。**
//
// 写真 A で保存を押す（POST A が飛行中）→ モーダルで写真 B へ送る →
// B で保存を押す（POST B 飛行中・楽観で saved=true・pending=true）→
// ここで POST A の応答が着地すると、A 側の `finally` が `busyRef` と
// `pending` を下ろしていた。番人が下りたので **B をもう一度押すと、
// B の POST がまだ飛行中なのに DELETE が飛ぶ**（PM が実コードで再現）。
//
// `stillSamePhoto()` で状態の書き込みは止めていたのに、番人の解除だけ
// 止めていなかった。
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    isGoneResponse: async () => false, sessionErrorMessage: () => null, readApiError: async () => "",
}));
vi.mock("../../utils/log", () => ({ log: { warn: () => {}, error: () => {}, info: () => {} } }));
import { usePhotoSave } from "../usePhotoSave";

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => { mockUserFetch.mockReset(); });

describe("前の写真の応答が着地しても、いまの写真の番人は下りない", () => {
    it("POST A 着地後も pending は true のまま、B への要求は POST 1本だけ", async () => {
        let releaseA: ((v: unknown) => void) | undefined;
        let releaseB: ((v: unknown) => void) | undefined;
        mockUserFetch.mockImplementation((p: string, init?: { method?: string }) => {
            if (p === "/photos/p1/save") return new Promise((r) => { releaseA = r; });
            if (p === "/photos/p2/save" && init?.method === "POST" && !releaseB) return new Promise((r) => { releaseB = r; });
            return Promise.resolve(ok({ saved: false }));
        });
        const { result, rerender } = renderHook(({ id }) => usePhotoSave(id, true), { initialProps: { id: "p1" } });

        // A で押す（応答は握ったまま）
        await act(async () => { void result.current.toggle(); await flush(); });
        // B へ送って、B で押す（こちらも握ったまま）
        rerender({ id: "p2" });
        await act(async () => { void result.current.toggle(); await flush(); });
        expect(result.current.pending).toBe(true);

        // ここで A の応答が着地する
        await act(async () => { releaseA?.(ok({ saved: true })); await flush(); });
        const pendingAfterALanded = result.current.pending;

        // B をもう一度押す。番人が生きていれば何も飛ばない
        await act(async () => { void result.current.toggle(); await flush(); });
        const methodsToB = mockUserFetch.mock.calls
            .filter((c) => c[0] === "/photos/p2/save")
            .map((c) => (c[1] as { method?: string } | undefined)?.method);

        await act(async () => { releaseB?.(ok({ saved: true })); await flush(); });

        expect(pendingAfterALanded).toBe(true);
        expect(methodsToB).toEqual(["POST"]);
    });

    // 同じ穴の、もう1つの形。A → B → A と戻ってから A で押し直すと、
    // 「まだ同じ写真か」だけでは古い A の着地を弾けない（写真は同じ）。
    // 要求ごとの通し番号で見分ける
    it("同じ写真へ戻ってから押し直しても、古い応答の着地で番人は下りない", async () => {
        const releases: Array<(v: unknown) => void> = [];
        mockUserFetch.mockImplementation((p: string, init?: { method?: string }) => {
            if (p === "/photos/p1/save" && init?.method === "POST") return new Promise((r) => { releases.push(r); });
            return Promise.resolve(ok({ saved: false }));
        });
        const { result, rerender } = renderHook(({ id }) => usePhotoSave(id, true), { initialProps: { id: "p1" } });

        await act(async () => { void result.current.toggle(); await flush(); });   // A（古い）
        rerender({ id: "p2" });
        rerender({ id: "p1" });
        await act(async () => { void result.current.toggle(); await flush(); });   // A（新しい）
        expect(releases).toHaveLength(2);
        expect(result.current.pending).toBe(true);

        await act(async () => { releases[0](ok({ saved: true })); await flush(); });   // 古い方が着地
        expect(result.current.pending).toBe(true);

        await act(async () => { void result.current.toggle(); await flush(); });
        const methods = mockUserFetch.mock.calls
            .filter((c) => c[0] === "/photos/p1/save")
            .map((c) => (c[1] as { method?: string } | undefined)?.method);
        expect(methods).toEqual(["POST", "POST"]);   // DELETE が混ざらない

        await act(async () => { releases[1](ok({ saved: true })); await flush(); });
        expect(result.current.pending).toBe(false);   // 新しい方が着地したら下りる
    });
});
