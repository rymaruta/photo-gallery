import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Escape で閉じられるモーダルは GalleryModal / StoryViewer / HeaderNav /
// FilterBar だけだった。削除確認・退会確認は閉じる手段がマウス前提で、
// キーボードだけの人は閉じるボタンまで Tab で辿るしかない。しかも
// フォーカスは押した要素に残ったままなので、**オーバーレイの裏にある
// ボタンを先に通過する**（/user/edit ではその先が「保存する」）。

vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));

const { default: DeleteConfirmModal } = await import("../DeleteConfirmModal");
const { default: DeleteAccountModal } = await import("../DeleteAccountModal");

const photo = { id: "p1", title: "夕焼け", src: "https://cdn/p1.jpg" } as never;
const esc = () => fireEvent.keyDown(document, { key: "Escape" });

beforeEach(() => { vi.clearAllMocks(); });

describe("写真の削除確認: Escape で閉じる", () => {
    it("Escape で onClose が呼ばれる", () => {
        const onClose = vi.fn();
        render(<DeleteConfirmModal photo={photo} isOpen onClose={onClose} onConfirm={vi.fn()} locale="ja" deleting={false} />);
        esc();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // 削除中に閉じられると、進行中の操作の結果が分からなくなる
    // （オーバーレイのクリックも同じ理由で止めてある）
    it("削除中は Escape で閉じない", () => {
        const onClose = vi.fn();
        render(<DeleteConfirmModal photo={photo} isOpen onClose={onClose} onConfirm={vi.fn()} locale="ja" deleting />);
        esc();
        expect(onClose).not.toHaveBeenCalled();
    });

    it("閉じているときは Escape を横取りしない", () => {
        const onClose = vi.fn();
        render(<DeleteConfirmModal photo={photo} isOpen={false} onClose={onClose} onConfirm={vi.fn()} locale="ja" deleting={false} />);
        esc();
        expect(onClose).not.toHaveBeenCalled();
    });

    it("ダイアログに名前がある（読み上げで何のダイアログか分かる）", () => {
        render(<DeleteConfirmModal photo={photo} isOpen onClose={vi.fn()} onConfirm={vi.fn()} locale="ja" deleting={false} />);
        expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "この写真を削除しますか？");
    });
});

describe("退会確認: Escape で閉じる", () => {
    it("Escape で onClose が呼ばれる", () => {
        const onClose = vi.fn();
        render(<DeleteAccountModal isOpen onClose={onClose} onConfirm={vi.fn()} locale="ja" deleting={false} />);
        esc();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("退会処理中は Escape で閉じない", () => {
        const onClose = vi.fn();
        render(<DeleteAccountModal isOpen onClose={onClose} onConfirm={vi.fn()} locale="ja" deleting />);
        esc();
        expect(onClose).not.toHaveBeenCalled();
    });

    it("ダイアログに名前がある", () => {
        render(<DeleteAccountModal isOpen onClose={vi.fn()} onConfirm={vi.fn()} locale="ja" deleting={false} />);
        expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "本当に退会しますか？");
    });
});

// Escape は塞いだが、Tab で**外へ漏れる**のは別問題。
// オーバーレイの裏のボタンにフォーカスが行き、見えないまま Enter で
// 押せてしまう（管理画面の裏は一覧の編集・削除ボタン）。
describe("削除確認: Tab が外へ漏れない", () => {
    const tab = (shift = false) => fireEvent.keyDown(document, { key: "Tab", shiftKey: shift });

    it("最後の要素から Tab すると中の先頭へ戻る", () => {
        render(
            <div>
                <button>裏のボタン</button>
                <DeleteConfirmModal photo={photo} isOpen onClose={vi.fn()} onConfirm={vi.fn()} locale="ja" deleting={false} />
            </div>,
        );
        const dialog = screen.getByRole("dialog");
        const inside = Array.from(dialog.querySelectorAll("button"));
        expect(inside.length).toBeGreaterThan(1);

        inside[inside.length - 1].focus();
        tab();
        expect(document.activeElement).toBe(inside[0]);
        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it("裏のボタンにフォーカスを当てて Tab すると、中へ引き戻す", () => {
        render(
            <div>
                <button>裏のボタン</button>
                <DeleteConfirmModal photo={photo} isOpen onClose={vi.fn()} onConfirm={vi.fn()} locale="ja" deleting={false} />
            </div>,
        );
        screen.getByText("裏のボタン").focus();
        tab();
        expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    });

    it("開いたら中へフォーカスが入る（body に落ちたままにしない）", () => {
        render(<DeleteConfirmModal photo={photo} isOpen onClose={vi.fn()} onConfirm={vi.fn()} locale="ja" deleting={false} />);
        expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    });
});

// 開いた瞬間にフォーカスが乗る先。DOM 順の先頭は赤い確定ボタンなので、
// 指名しないと**開いた直後の Enter が削除になる**。
// 変更前はフォーカスが起動元に残っていたので、確認シートの上で Enter を
// 打っても何も起きなかった。
describe("削除確認: 最初のフォーカスは確定ボタンではない", () => {
    it("キャンセル側に入る", () => {
        render(<DeleteConfirmModal photo={photo} isOpen onClose={vi.fn()} onConfirm={vi.fn()} locale="ja" deleting={false} />);
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "キャンセル" }));
    });

    it("確定ボタン（削除する）には入らない", () => {
        render(<DeleteConfirmModal photo={photo} isOpen onClose={vi.fn()} onConfirm={vi.fn()} locale="ja" deleting={false} />);
        expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "削除する" }));
    });
});

// React は autoFocus をエフェクトより前に当てるので、既定の戻り先
// （開いた瞬間の activeElement）は**このモーダルの中の入力欄**になる。
// 閉じるとその要素ごと消えてフォーカスが body に落ちる——「戻さないと
// body に落ちる」が、戻しているつもりで起きていた。
describe("退会確認: 閉じたら起動元へ戻る（autoFocus に奪われない）", () => {
    function Harness({ open }: { open: boolean }) {
        const opener = React.useRef<HTMLButtonElement | null>(null);
        return (
            <div>
                <button ref={opener}>退会する</button>
                {open && (
                    <DeleteAccountModal isOpen openerRef={opener} onClose={vi.fn()} onConfirm={vi.fn()} locale="ja" deleting={false} />
                )}
            </div>
        );
    }

    it("autoFocus の入力欄ではなく、退会ボタンへ戻す", () => {
        const { rerender } = render(<Harness open={false} />);
        const opener = screen.getByText("退会する");
        opener.focus();

        rerender(<Harness open />);
        // 開いている間は確認語の入力欄（autoFocus）にいる
        expect(document.activeElement).toBe(screen.getByPlaceholderText("退会"));

        rerender(<Harness open={false} />);
        expect(document.activeElement).toBe(opener);
    });
});
