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
