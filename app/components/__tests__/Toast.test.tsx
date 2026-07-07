import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// トーストが1件出ている状態を作る
vi.mock("../../../lib/hooks/useToast", () => ({
    useToast: () => ({
        toasts: [{ id: "1", message: "保存しました", type: "success" }],
        removeToast: vi.fn(),
    }),
}));

import ToastContainer from "../Toast";

// 回帰ガード: トーストは右上に出すとヘッダーのハンバーガーを覆い、
// メニューが「反応しない」原因になる。画面下部・クリック透過を強制する。
describe("ToastContainer - ヘッダーと重ならない配置の回帰ガード", () => {
    it("トーストは画面下部に表示され、上部（ヘッダー領域）を覆わない", () => {
        const { container } = render(<ToastContainer />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).toContain("bottom-4");
        expect(root.className).not.toContain("top-4");
    });

    it("コンテナ自体はクリックを透過する（空き領域がヘッダー操作を奪わない）", () => {
        const { container } = render(<ToastContainer />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).toContain("pointer-events-none");
    });
});
