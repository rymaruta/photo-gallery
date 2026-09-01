import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

import { useEscapeKey } from "../useEscapeKey";

const pressEscape = () => fireEvent.keyDown(document, { key: "Escape" });

describe("useEscapeKey", () => {
    it("開いている間は Escape を拾う", () => {
        const onEscape = vi.fn();
        renderHook(() => useEscapeKey(true, onEscape));
        pressEscape();
        expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it("閉じている間は拾わない", () => {
        const onEscape = vi.fn();
        renderHook(() => useEscapeKey(false, onEscape));
        pressEscape();
        expect(onEscape).not.toHaveBeenCalled();
    });

    it("Escape 以外では呼ばない", () => {
        const onEscape = vi.fn();
        renderHook(() => useEscapeKey(true, onEscape));
        fireEvent.keyDown(document, { key: "Enter" });
        fireEvent.keyDown(document, { key: "Esc" });   // 古い名前は拾わない
        expect(onEscape).not.toHaveBeenCalled();
    });

    // 外しそこねると、閉じたあとのモーダルが次の Escape を横取りする
    it("アンマウントで購読を外す", () => {
        const onEscape = vi.fn();
        const { unmount } = renderHook(() => useEscapeKey(true, onEscape));
        unmount();
        pressEscape();
        expect(onEscape).not.toHaveBeenCalled();
    });

    it("active が false に変わったら、その時点で外れる", () => {
        const onEscape = vi.fn();
        const { rerender } = renderHook(({ a }) => useEscapeKey(a, onEscape), {
            initialProps: { a: true },
        });
        rerender({ a: false });
        pressEscape();
        expect(onEscape).not.toHaveBeenCalled();
    });
});
