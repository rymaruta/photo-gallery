import React, { useRef } from "react";
import { describe, it, expect } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

import { useFocusTrap } from "../useFocusTrap";

// `aria-modal="true"` と言いながら Tab で外へ出られるモーダルが5つあった。
// オーバーレイの裏のボタンにフォーカスが行き、見えないまま Enter で
// 押せてしまう（/user/edit の確認シートの裏は「保存する」）。

function Fixture({ open }: { open: boolean }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useFocusTrap(open, ref);
    return (
        <div>
            <button>外1</button>
            {open && (
                <div ref={ref} role="dialog">
                    <button>中1</button>
                    <button>中2</button>
                </div>
            )}
            <button>外2</button>
        </div>
    );
}

const tab = (shift = false) => fireEvent.keyDown(document, { key: "Tab", shiftKey: shift });

describe("useFocusTrap", () => {
    it("開いたら中の最初の要素へフォーカスが移る", () => {
        render(<Fixture open />);
        expect(document.activeElement).toBe(screen.getByText("中1"));
    });

    it("最後の要素から Tab すると先頭へ戻る（外へ出さない）", () => {
        render(<Fixture open />);
        screen.getByText("中2").focus();
        tab();
        expect(document.activeElement).toBe(screen.getByText("中1"));
    });

    it("先頭から Shift+Tab すると最後へ回る", () => {
        render(<Fixture open />);
        screen.getByText("中1").focus();
        tab(true);
        expect(document.activeElement).toBe(screen.getByText("中2"));
    });

    // ポータルで body の末尾に出るモーダルは、外から Tab で入ってくる
    it("外にフォーカスがある状態で Tab すると中へ引き戻す", () => {
        render(<Fixture open />);
        screen.getByText("外2").focus();
        tab();
        expect(document.activeElement).toBe(screen.getByText("中1"));
    });

    it("閉じている間は何もしない", () => {
        render(<Fixture open={false} />);
        screen.getByText("外2").focus();
        tab();
        expect(document.activeElement).toBe(screen.getByText("外2"));
    });

    // 戻さないとフォーカスが body に落ち、次の Tab がページ先頭からになる
    it("閉じたら開く前の要素へ戻す", () => {
        const { rerender } = render(<Fixture open={false} />);
        const opener = screen.getByText("外1");
        opener.focus();
        rerender(<Fixture open />);
        expect(document.activeElement).toBe(screen.getByText("中1"));

        rerender(<Fixture open={false} />);
        expect(document.activeElement).toBe(opener);
    });

    // autoFocus を使っているモーダル（退会確認）の指定を奪わない
    it("中に既にフォーカスがあれば動かさない", () => {
        function WithAutoFocus() {
            const ref = useRef<HTMLDivElement | null>(null);
            useFocusTrap(true, ref);
            return (
                <div ref={ref}>
                    <button>先頭</button>
                    <input autoFocus placeholder="確認" />
                </div>
            );
        }
        render(<WithAutoFocus />);
        expect(document.activeElement).toBe(screen.getByPlaceholderText("確認"));
    });
});
