import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewerHistory } from "../useViewerHistory";

/**
 * **その場で開くビューアを、戻るで閉じられるようにする。**
 *
 * 積まないと、戻るで**ページごと離脱する**——`/location/*` は検索の
 * 着地点なので、そこで押すと**サイトの外**へ出る。
 */
const pushSpy = vi.fn();
const replaceSpy = vi.fn();
const backSpy = vi.fn();
let state: Record<string, unknown> | null = null;

beforeEach(() => {
    pushSpy.mockReset(); replaceSpy.mockReset(); backSpy.mockReset();
    state = null;
    vi.spyOn(window.history, "pushState").mockImplementation(((s: unknown) => {
        state = s as Record<string, unknown>; pushSpy(s);
    }) as typeof window.history.pushState);
    vi.spyOn(window.history, "replaceState").mockImplementation(((s: unknown) => {
        state = s as Record<string, unknown>; replaceSpy(s);
    }) as typeof window.history.replaceState);
    vi.spyOn(window.history, "back").mockImplementation(() => { backSpy(); });
    vi.spyOn(window.history, "state", "get").mockImplementation(() => state);
});
afterEach(() => vi.restoreAllMocks());

const setup = (open: boolean, onClose = vi.fn()) =>
    renderHook(({ o }: { o: boolean }) => useViewerHistory(o, onClose), { initialProps: { o: open } });

describe("ビューアの履歴", () => {
    it("閉じている間は履歴を触らない", () => {
        setup(false);
        expect(pushSpy).not.toHaveBeenCalled();
        expect(backSpy).not.toHaveBeenCalled();
    });

    it("開くと1件積む", () => {
        const { rerender } = setup(false);
        act(() => rerender({ o: true }));
        expect(pushSpy).toHaveBeenCalledTimes(1);
        expect((pushSpy.mock.calls[0][0] as Record<string, unknown>).viewerOpen).toBe(true);
    });

    // 🔴 **送るたびには積まない。** 積むと、閉じるのに送った回数ぶん
    // 戻るを押すことになる
    it("開いたまま再描画しても積み直さない", () => {
        const { rerender } = setup(false);
        act(() => rerender({ o: true }));
        act(() => rerender({ o: true }));
        act(() => rerender({ o: true }));
        expect(pushSpy).toHaveBeenCalledTimes(1);
    });

    it("閉じると、自分が積んだ1件を戻して消す", () => {
        const { rerender } = setup(false);
        act(() => rerender({ o: true }));
        act(() => rerender({ o: false }));
        expect(backSpy).toHaveBeenCalledTimes(1);
    });

    // 🔴 **戻るで閉じたときは、こちらから back() しない。**
    // ブラウザが既に1件戻している。二重に戻すと前のページまで飛ぶ
    it("戻るで閉じたときは二重に戻さない", () => {
        const onClose = vi.fn();
        const { rerender } = setup(false, onClose);
        act(() => rerender({ o: true }));
        act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
        expect(onClose).toHaveBeenCalledTimes(1);
        act(() => rerender({ o: false }));
        expect(backSpy).not.toHaveBeenCalled();
    });

    // 🔴 **開いたまま画面を離れたら何もしない。** ビューアの中のリンクを
    // 押したとき、ここで back() を撃つと**押した行き先から引き返す**
    it("開いたまま外れても back() しない", () => {
        const { rerender, unmount } = setup(false);
        act(() => rerender({ o: true }));
        act(() => unmount());
        expect(backSpy).not.toHaveBeenCalled();
    });

    // **Next の内部キーを持ち越す**（`__NA` を潰すと、戻るたびにページが
    // 丸ごと再読み込みされる）
    it("履歴の state に Next の内部キーを持ち越す", () => {
        state = { __NA: 1, __PRIVATE_NEXTJS_INTERNALS_TREE: ["t"] };
        const { rerender } = setup(false);
        act(() => rerender({ o: true }));
        const wrote = pushSpy.mock.calls[0][0] as Record<string, unknown>;
        expect(wrote.__NA).toBe(1);
        expect(wrote.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual(["t"]);
    });

    // 自分の印が消えている（別の誰かが履歴を書いた）なら戻さない
    it("自分の1件でなくなっていたら戻さない", () => {
        const { rerender } = setup(false);
        act(() => rerender({ o: true }));
        state = { somethingElse: true };
        act(() => rerender({ o: false }));
        expect(backSpy).not.toHaveBeenCalled();
    });
});
