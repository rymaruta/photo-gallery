import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

// 環境変数はモジュール読込時に評価されるため、stub してから動的 import する
vi.stubEnv("NEXT_PUBLIC_CLOUDFRONT_URL", "https://cdn.test");
const { default: UserAvatar } = await import("../UserAvatar");

describe("UserAvatar", () => {
    it("CloudFront のプロフィール画像URLで img を描画する", () => {
        const { container } = render(<UserAvatar userId="user-1" />);
        const img = container.querySelector("img")!;
        expect(img).not.toBeNull();
        expect(img.src).toBe("https://cdn.test/profiles/user-1");
    });

    it("userId は URL エンコードされる", () => {
        const { container } = render(<UserAvatar userId="a b/c" />);
        const img = container.querySelector("img")!;
        expect(img.src).toContain(`/profiles/${encodeURIComponent("a b/c")}`);
    });

    // 空を弾かないと `/profiles/` を取りに行く。退会した人のコメント
    // （CommentSection が userId="" で呼ぶ）1件につき 403 が1本飛び、
    // アイコンに落ちるまでちらつく。
    it("userId が空なら画像を取りに行かない（アイコンだけ出す）", () => {
        const { container } = render(<UserAvatar userId="" />);
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("svg")).not.toBeNull();
    });

    it("cacheBust 指定でクエリが付く", () => {
        const { container } = render(<UserAvatar userId="u1" cacheBust={123} />);
        expect(container.querySelector("img")!.src).toContain("?v=123");
    });

    it("画像の読込失敗でアイコンにフォールバックする", () => {
        const { container } = render(<UserAvatar userId="u1" />);
        const img = container.querySelector("img")!;
        fireEvent.error(img);
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("svg")).not.toBeNull();
    });

    it("サイズクラスが外枠に適用される", () => {
        const { container } = render(<UserAvatar userId="u1" className="w-14 h-14" />);
        const wrapper = container.firstElementChild!;
        expect(wrapper.className).toContain("w-14 h-14");
        expect(wrapper.className).toContain("rounded-full");
    });
});
