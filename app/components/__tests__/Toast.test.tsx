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
    // **綴りではなく「下にいること」を見る。** `bottom-4` という**クラス名**を
    // 見ていたので、safe-area を空けるために `style={{ bottom: calc(env(...)+16px) }}`
    // へ移したときに、置き場所は何も変わっていないのに落ちた。
    // 見たいのは「下にいる／上にいない」であってクラス名ではない。
    it("トーストは画面下部に表示され、上部（ヘッダー領域）を覆わない", () => {
        const { container } = render(<ToastContainer />);
        const root = container.firstElementChild as HTMLElement;
        const bottom = root.style.bottom || (/(^|\s)bottom-(\d+)(\s|$)/.test(root.className) ? "class" : "");
        expect(bottom, "下端からの位置が指定されていない").toBeTruthy();
        expect(root.className, "上に出している（ヘッダーを覆う）").not.toContain("top-4");
        expect(root.style.top, "上に出している（ヘッダーを覆う）").toBeFalsy();
    });

    // ホームインジケーターのある端末では下 34px が帯になる。
    // `globals.css` の body 側の padding は `position: fixed` には効かない
    it("ホームインジケーターの領域を空ける", () => {
        const { container } = render(<ToastContainer />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.style.bottom, "safe-area を空けていない").toContain("safe-area-inset-bottom");
    });

    it("コンテナ自体はクリックを透過する（空き領域がヘッダー操作を奪わない）", () => {
        const { container } = render(<ToastContainer />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).toContain("pointer-events-none");
    });
});
