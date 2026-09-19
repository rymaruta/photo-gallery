import React, { useRef } from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { usePublishedHeight } from "../useBottomBarHeight";

// 画面下に重なりうるもの（投稿バー・ミニプレイヤー・「＋」）が、下にあるものの
// 高さぶん逃げるための変数。`enabled` が false の間は出さない・外れたら消す

function Box({ enabled, h }: { enabled: boolean; h: number }) {
    const ref = useRef<HTMLDivElement | null>(null);
    usePublishedHeight(ref, "--mini-player-h", enabled);
    return <div ref={(el) => { ref.current = el; if (el) Object.defineProperty(el, "offsetHeight", { value: h, configurable: true }); }} />;
}

describe("usePublishedHeight", () => {
    it("有効なら実測の高さを出し、外れたら消す", () => {
        const { unmount } = render(<Box enabled h={72} />);
        expect(document.documentElement.style.getPropertyValue("--mini-player-h")).toBe("72px");
        unmount();
        expect(document.documentElement.style.getPropertyValue("--mini-player-h")).toBe("");
    });

    it("無効の間は出さない（デスクトップで動かしたミニプレイヤー）", () => {
        const { rerender } = render(<Box enabled={false} h={72} />);
        expect(document.documentElement.style.getPropertyValue("--mini-player-h")).toBe("");
        rerender(<Box enabled h={72} />);
        expect(document.documentElement.style.getPropertyValue("--mini-player-h")).toBe("72px");
        rerender(<Box enabled={false} h={72} />);
        expect(document.documentElement.style.getPropertyValue("--mini-player-h")).toBe("");
    });
});
