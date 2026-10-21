import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EmptyState, ErrorState, LoadingState, LOADING_REVEAL_MS } from "../StateViews";

// 空・失敗・読み込み中の共通の形（iOS の `ErrorBanner` / `EmptyState` / `JPLoadingState`）
afterEach(() => { vi.useRealTimers(); });

describe("ErrorState", () => {
    it("灰の三角（赤にしない）・明朝 20 の見出し・15 の説明・44 の「もう一度試す」", () => {
        const onRetry = vi.fn();
        const { container } = render(<ErrorState title="読み込めませんでした" message="通信を確かめてください。" onRetry={onRetry} />);
        const icon = container.querySelector("svg")!;
        expect(icon.getAttribute("aria-hidden")).toBe("true");
        expect(icon.getAttribute("class")).toContain("text-text-3");
        expect(icon.getAttribute("class")).not.toContain("danger");
        const title = screen.getByRole("heading", { name: "読み込めませんでした" });
        expect(title.className).toContain("font-serif");
        expect(title.style.fontSize).toBe("20px");
        expect(screen.getByText("通信を確かめてください。").style.fontSize).toBe("15px");
        const retry = screen.getByRole("button", { name: "もう一度試す" });
        expect(retry.style.minHeight).toBe("44px");
        fireEvent.click(retry);
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("取り直せない画面には「もう一度試す」を出さない。読み直し中は押せない", () => {
        const { rerender } = render(<ErrorState message="x" />);
        expect(screen.queryByRole("button")).toBeNull();
        rerender(<ErrorState message="x" onRetry={() => {}} busy />);
        expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    });
});

describe("EmptyState", () => {
    it("三角は出さない（0件は失敗ではない）。一手は真鍮の塗りに墨の字・44", () => {
        const onClick = vi.fn();
        const { container } = render(<EmptyState message="まだありません。" action={{ label: "リセット", onClick }} />);
        expect(container.querySelector("svg")).toBeNull();
        const btn = screen.getByRole("button", { name: "リセット" });
        expect(btn.className).toContain("bg-accent-fill");
        expect(btn.className).toContain("text-ink");
        expect(btn.className).not.toContain("text-white");
        expect(btn.style.minHeight).toBe("44px");
        fireEvent.click(btn);
        expect(onClick).toHaveBeenCalled();
    });

    it("行き先がある一手はリンク（先読みしない）", () => {
        render(<EmptyState message="まだありません。" action={{ label: "写真を投稿する", href: "/user/upload" }} />);
        expect(screen.getByRole("link", { name: "写真を投稿する" }).getAttribute("href")).toBe("/user/upload");
    });
});

describe("LoadingState", () => {
    it("0.3 秒までは骨組みを出さない（ちらつかせない）。読み上げは「読み込み中」1つ", () => {
        vi.useFakeTimers();
        render(<LoadingState />);
        expect(screen.getByRole("status").textContent).toBe("読み込み中");
        expect(screen.queryByTestId("state-loading-bones")).toBeNull();
        act(() => { vi.advanceTimersByTime(LOADING_REVEAL_MS - 1); });
        expect(screen.queryByTestId("state-loading-bones")).toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        const bones = screen.getByTestId("state-loading-bones");
        expect(bones.getAttribute("aria-hidden")).toBe("true");
        // 格子は 3 列・6 枚
        expect(bones.querySelectorAll(".aspect-square").length).toBe(6);
    });

    it("光を流さない（animate-* を付けない）", () => {
        const { container } = render(<LoadingState delayMs={0} />);
        expect(container.innerHTML).not.toMatch(/animate-/);
    });
});

describe("置き換えた画面が共通の形を通る", () => {
    const ROOT = path.resolve(__dirname, "../../..");
    const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
    it.each([
        ["app/GalleryPageClient.tsx", ["EmptyState"]],
        ["app/components/GalleryGrid.tsx", ["EmptyState"]],
        ["app/users/UserProfileClient.tsx", ["EmptyState", "LoadingState"]],
        ["app/components/CommentSection.tsx", ["EmptyState", "ErrorState", "LoadingState"]],
        ["app/components/NotificationsBell.tsx", ["EmptyState", "ErrorState", "LoadingState"]],
    ])("%s", (file, parts) => {
        const src = read(file);
        for (const p of parts) expect(src, p).toMatch(new RegExp(`<${p}\\b`));
        expect(src).toMatch(/from "\.{1,2}\/(components\/)?StateViews"/);
    });

    it("コメントの一覧の読み込み中に回る輪を出さない（送るボタンの中の輪1つだけ残る）", () => {
        expect(read("app/components/CommentSection.tsx").match(/animate-spin/g)?.length).toBe(1);
    });
});
