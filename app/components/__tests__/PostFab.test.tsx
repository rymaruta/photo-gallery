import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * 画面右下の「＋」（投稿の入口）。
 *
 * owner:「画面の UI からどこに投稿する機能があるか分かりづらい」。
 * - 投稿できる人（ログイン済み＋グループ）にだけ出る
 * - 投稿・編集・管理・ログイン系の画面では出ない（画面下に自分のバーがある／筋が無い）
 * - 押すと「写真を投稿／ストーリーを投稿」。写真は `/user/upload` へ、ストーリーは
 *   その場でファイルを選び、バーが在ればそこへ・無ければ預けてトップへ
 */
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, isAdminUser: false, isGeneralUser: true } }));
const nav = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));
vi.mock("../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: nav.push }) }));

import PostFab from "../PostFab";
import { handOffStoryFile, onStoryFileHandoff, resetStoryHandoff, takeHandedStoryFile } from "../../../lib/utils/storyHandoff";
import { FOCUSABLE } from "../../../lib/hooks/useFocusTrap";

const fab = () => screen.queryByRole("button", { name: "投稿する" });
const openSheet = () => { fireEvent.click(fab()!); return screen.getByRole("dialog", { name: "投稿する" }); };
const pick = (file: File) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
};

beforeEach(() => {
    authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true };
    nav.pathname = "/"; nav.push.mockReset();
    resetStoryHandoff();
    document.body.innerHTML = "";
});

describe("PostFab", () => {
    it("投稿できる人にだけ出る", () => {
        const { unmount } = render(<PostFab />);
        expect(fab()).toBeInTheDocument();
        unmount();
        authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: false };   // グループ無し
        const r2 = render(<PostFab />);
        expect(fab(), "投稿権限が無い人に出している（押した先が会員限定の案内になる）").toBeNull();
        r2.unmount();
        authState.current = { isAuthenticated: false, isAdminUser: false, isGeneralUser: false };
        render(<PostFab />);
        expect(fab()).toBeNull();
    });

    it("投稿・編集・管理・ログイン系の画面では出ない（それ以外では出る）", () => {
        for (const p of ["/user/upload", "/user/edit", "/user/profile", "/user/drafts", "/admin", "/admin/edit", "/login", "/signup", "/j"]) {
            nav.pathname = p;
            const r = render(<PostFab />);
            expect(fab(), `${p} で出ている`).toBeNull();
            r.unmount();
        }
        for (const p of ["/", "/photo/abc", "/users/abc", "/tag/x", "/map", "/favorites", "/terms"]) {
            nav.pathname = p;
            const r = render(<PostFab />);
            expect(fab(), `${p} で出ていない`).toBeInTheDocument();
            r.unmount();
        }
    });

    it("「写真を投稿」はアップロード画面へ", () => {
        render(<PostFab />);
        openSheet();
        fireEvent.click(screen.getByRole("button", { name: /写真を投稿/ }));
        expect(nav.push).toHaveBeenCalledWith("/user/upload");
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("「ストーリーを投稿」: バーが受け取れるならその場で渡し、移動しない", () => {
        const got: File[] = [];
        const off = onStoryFileHandoff((f) => got.push(f));
        render(<PostFab />);
        openSheet();
        const file = new File(["x"], "s.jpg", { type: "image/jpeg" });
        pick(file);
        expect(got).toEqual([file]);
        expect(nav.push, "バーが受け取ったのに移動している").not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).toBeNull();
        off();
    });

    it("「ストーリーを投稿」: バーが無いページでは預けてトップへ", () => {
        nav.pathname = "/photo/abc";
        render(<PostFab />);
        openSheet();
        const file = new File(["x"], "s.jpg", { type: "image/jpeg" });
        pick(file);
        expect(nav.push).toHaveBeenCalledWith("/");
        expect(takeHandedStoryFile(), "預けていない").toBe(file);
        expect(takeHandedStoryFile(), "2回取れる").toBeNull();
    });

    it("Escape と背景で閉じる。開いている間は本文のスクロールを止める", () => {
        render(<PostFab />);
        openSheet();
        expect(document.body.style.overflow || document.documentElement.style.overflow || document.body.style.position).not.toBe("");
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("dialog"), "Escape で閉じない").toBeNull();
        openSheet();
        fireEvent.click(screen.getByTestId("post-fab-backdrop"));
        expect(screen.queryByRole("dialog"), "背景で閉じない").toBeNull();
    });

    it("画面が変わったら閉じる（ルートレイアウトなので再マウントされない）", () => {
        const { rerender } = render(<PostFab />);
        openSheet();
        nav.pathname = "/photo/abc";
        rerender(<PostFab />);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    // 🔴 レビューが指摘: 隠しファイル入力を dialog の中に置くと、閉じ込めの
    // 「最後の要素」がそれになる（`FOCUSABLE` は input を含み、見えないかは見ない）
    // ＝Shift+Tab が行き止まり・Tab が外へ漏れる。**選択子は実装から取る**
    it("閉じ込めの端は見える部品（隠しファイル入力は dialog の中に無い）", () => {
        render(<PostFab />);
        const dialog = openSheet();
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        expect(items.length).toBeGreaterThan(0);
        expect(items.some((el) => el.tagName === "INPUT"), "隠しファイル入力が閉じ込めの中に居る").toBe(false);
        // 閉じる手段（×）が閉じ込めの中にある
        expect(items.some((el) => el.getAttribute("aria-label") === "閉じる")).toBe(true);
        // 入力そのものは残っている（選ぶのはここ）
        expect(document.querySelector('input[type="file"]')).toBeTruthy();
        // 両端は見える部品（× が先頭・ストーリーが末尾）
        expect(items[0].getAttribute("aria-label")).toBe("閉じる");
        expect(items[items.length - 1].textContent).toContain("ストーリーを投稿");
    });

    // × が先頭に来たので、何もしないと開いた瞬間の読み上げが「閉じる ボタン」から始まる
    it("開いたら主の操作（写真を投稿）にフォーカスが当たる", () => {
        render(<PostFab />);
        openSheet();
        expect(document.activeElement?.textContent).toContain("写真を投稿");
    });

    it("× で閉じ、フォーカスは「＋」へ戻る", () => {
        render(<PostFab />);
        openSheet();
        fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(fab());
    });

    // 640px 未満は root が 14px なので、rem の指定は端末で縮む（`w-11` → 38.5px）。
    // 押せる面と字は px で固定していることを見る
    it("× と絵は px で 44 / 56、字は 20/18/14（rem で縮まない）", () => {
        render(<PostFab />);
        const dialog = openSheet();
        expect(screen.getByRole("button", { name: "閉じる" }).className).toMatch(/w-\[44px\] h-\[44px\]/);
        expect(dialog.querySelectorAll(".w-\\[56px\\]").length).toBe(2);
        expect(dialog.querySelector("h2")?.className).toMatch(/text-\[20px\]/);
        expect(dialog.querySelectorAll(".text-\\[18px\\]").length).toBe(2);
        expect(dialog.querySelectorAll(".text-\\[14px\\]").length).toBe(2);
    });

    // クエリだけ変わる戻る（`/users?id=A` → `?id=B`）はパスが同じ。`HeaderNav` と同じ穴
    it("クエリだけ変わる戻るでも閉じる（popstate）", () => {
        render(<PostFab />);
        openSheet();
        fireEvent(window, new PopStateEvent("popstate"));
        expect(screen.queryByRole("dialog"), "戻ったのにシートが残っている").toBeNull();
    });

    it("受け渡しは1件だけ預かる（後から来た方が勝つ）", () => {
        const a = new File(["a"], "a.jpg", { type: "image/jpeg" });
        const b = new File(["b"], "b.jpg", { type: "image/jpeg" });
        expect(handOffStoryFile(a)).toBe(false);
        expect(handOffStoryFile(b)).toBe(false);
        expect(takeHandedStoryFile()).toBe(b);
    });
});
