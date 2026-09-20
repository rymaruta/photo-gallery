import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * 「投稿する」の2択（写真／ストーリー）。
 *
 * 開く場所はマイページの「投稿する」だけ（画面右下に浮いていた「＋」は
 * owner の判断で撤去。owner:「それがあれば、逆にさっき作ったプラスボタンで
 * 投稿かストーリーどっちか選べるというのはいらない」）。
 * **この試験はシートそのものを見る**——入口の出し分けは呼ぶ側の試験
 * （`app/users/__tests__/UserProfileClient.postButton.test.tsx`）。
 */
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));

import PostSheet from "../PostSheet";
import { handOffStoryFile, onStoryFileHandoff, resetStoryHandoff, takeHandedStoryFile } from "../../../lib/utils/storyHandoff";
import { FOCUSABLE } from "../../../lib/hooks/useFocusTrap";

/** 開くボタン＋シート（本番の呼び方と同じく「開いている間だけマウント」） */
function Harness() {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLButtonElement | null>(null);
    const close = React.useCallback(() => setOpen(false), []);
    return (
        <>
            <button ref={ref} type="button" onClick={() => setOpen(true)}>ひらく</button>
            {open && <PostSheet onClose={close} locale="ja" restoreRef={ref} />}
        </>
    );
}

const trigger = () => screen.getByRole("button", { name: "ひらく" });
const openSheet = () => { fireEvent.click(trigger()); return screen.getByRole("dialog", { name: "投稿する" }); };
const sheet = () => screen.queryByRole("dialog", { name: "投稿する" });
const pick = (file: File) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
};

beforeEach(() => {
    nav.push.mockReset();
    resetStoryHandoff();
    document.body.innerHTML = "";
});

describe("PostSheet", () => {
    it("「写真を投稿」はアップロード画面へ", () => {
        render(<Harness />);
        openSheet();
        fireEvent.click(screen.getByRole("button", { name: /写真を投稿/ }));
        expect(nav.push).toHaveBeenCalledWith("/user/upload");
        expect(sheet()).toBeNull();
    });

    it("「ストーリーを投稿」: バーが受け取れるならその場で渡し、移動しない", () => {
        const got: File[] = [];
        const off = onStoryFileHandoff((f) => got.push(f));
        render(<Harness />);
        openSheet();
        const file = new File(["x"], "s.jpg", { type: "image/jpeg" });
        pick(file);
        expect(got).toEqual([file]);
        expect(nav.push, "バーが受け取ったのに移動している").not.toHaveBeenCalled();
        expect(sheet()).toBeNull();
        off();
    });

    it("「ストーリーを投稿」: バーが無いページでは預けてトップへ", () => {
        render(<Harness />);
        openSheet();
        const file = new File(["x"], "s.jpg", { type: "image/jpeg" });
        pick(file);
        expect(nav.push).toHaveBeenCalledWith("/");
        expect(takeHandedStoryFile(), "預けていない").toBe(file);
        expect(takeHandedStoryFile(), "2回取れる").toBeNull();
    });

    it("受け渡しは1件だけ預かる（後から来た方が勝つ）", () => {
        const a = new File(["a"], "a.jpg", { type: "image/jpeg" });
        const b = new File(["b"], "b.jpg", { type: "image/jpeg" });
        expect(handOffStoryFile(a)).toBe(false);
        expect(handOffStoryFile(b)).toBe(false);
        expect(takeHandedStoryFile()).toBe(b);
    });

    it("Escape と背景で閉じる。開いている間は本文のスクロールを止める", () => {
        render(<Harness />);
        openSheet();
        expect(document.body.style.overflow || document.documentElement.style.overflow || document.body.style.position).not.toBe("");
        fireEvent.keyDown(document, { key: "Escape" });
        expect(sheet(), "Escape で閉じない").toBeNull();
        openSheet();
        fireEvent.click(screen.getByTestId("post-sheet-backdrop"));
        expect(sheet(), "背景で閉じない").toBeNull();
    });

    // クエリだけ変わる戻る（`/users?id=A` → `?id=B`）はパスが変わらない。`HeaderNav` と同じ穴
    it("クエリだけ変わる戻るでも閉じる（popstate）", () => {
        render(<Harness />);
        openSheet();
        fireEvent(window, new PopStateEvent("popstate"));
        expect(sheet(), "戻ったのにシートが残っている").toBeNull();
    });

    // 🔴 隠しファイル入力を dialog の中に置くと、閉じ込めの「最後の要素」がそれになる
    // （`FOCUSABLE` は input を含み、見えないかは見ない）＝Shift+Tab が行き止まり・
    // Tab が外へ漏れる。**選択子は実装から取る**
    it("閉じ込めの端は見える部品（隠しファイル入力は dialog の中に無い）", () => {
        render(<Harness />);
        const dialog = openSheet();
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        expect(items.length).toBeGreaterThan(0);
        expect(items.some((el) => el.tagName === "INPUT"), "隠しファイル入力が閉じ込めの中に居る").toBe(false);
        expect(document.querySelector('input[type="file"]'), "入力そのものが消えている").toBeTruthy();
        // 両端は見える部品（× が先頭・ストーリーが末尾）
        expect(items[0].getAttribute("aria-label")).toBe("閉じる");
        expect(items[items.length - 1].textContent).toContain("ストーリーを投稿");
    });

    // × が先頭に来たので、何もしないと開いた瞬間の読み上げが「閉じる ボタン」から始まる
    it("開いたら主の操作（写真を投稿）にフォーカスが当たる", () => {
        render(<Harness />);
        openSheet();
        expect(document.activeElement?.textContent).toContain("写真を投稿");
    });

    it("× で閉じ、フォーカスは開いたボタンへ戻る", () => {
        render(<Harness />);
        const btn = trigger();
        openSheet();
        fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
        expect(sheet()).toBeNull();
        expect(document.activeElement).toBe(btn);
    });

    // 640px 未満は root が 14px なので、rem の指定は端末で縮む（`w-11` → 38.5px）。
    // 押せる面と字は px で固定していることを見る
    it("× と絵は px で 44 / 56、字は 20/18/14（rem で縮まない）", () => {
        render(<Harness />);
        const dialog = openSheet();
        expect(screen.getByRole("button", { name: "閉じる" }).className).toMatch(/w-\[44px\] h-\[44px\]/);
        expect(dialog.querySelectorAll(".w-\\[56px\\]").length).toBe(2);
        expect(dialog.querySelector("h2")?.className).toMatch(/text-\[20px\]/);
        expect(dialog.querySelectorAll(".text-\\[18px\\]").length).toBe(2);
        expect(dialog.querySelectorAll(".text-\\[14px\\]").length).toBe(2);
    });
});
