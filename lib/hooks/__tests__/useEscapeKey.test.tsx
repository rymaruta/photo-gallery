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
    // **変換中の Escape は「変換の取り消し」**。閉じてはいけない。
    //
    // 退会の確認モーダルは `退会` と打たせる＝**IME 必須**なので、
    // 「たいかい」の変換をやめようとしただけでモーダルごと閉じ、
    // 打ち直しになっていた（Chromium で `onClose` が呼ばれることを確認）。
    // 変換中の Escape も `key: "Escape"` として届く（実測）。
    it("変換中の Escape では閉じない", () => {
        const onEscape = vi.fn();
        renderHook(() => useEscapeKey(true, onEscape));
        fireEvent.keyDown(document, { key: "Escape", keyCode: 27, isComposing: true });
        expect(onEscape, "変換の取り消しでモーダルが閉じる").not.toHaveBeenCalled();
    });

    // `isComposing` を持たない環境向けの保険
    it("keyCode 229 でも閉じない", () => {
        const onEscape = vi.fn();
        renderHook(() => useEscapeKey(true, onEscape));
        fireEvent.keyDown(document, { key: "Escape", keyCode: 229 });
        expect(onEscape).not.toHaveBeenCalled();
    });

    // **正常系。確定後・英語入力の Escape は今までどおり閉じる**
    it("変換していない Escape は今までどおり閉じる", () => {
        const onEscape = vi.fn();
        renderHook(() => useEscapeKey(true, onEscape));
        fireEvent.keyDown(document, { key: "Escape", keyCode: 27, isComposing: false });
        expect(onEscape).toHaveBeenCalledTimes(1);
    });
});
