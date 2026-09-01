import React, { useRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useBottomBarHeight } from "../useBottomBarHeight";

// **決め打ちの 80px が合っていなかった。**
// `MiniPlayer` は「`p-4` + ボタン44px + 枠線 ≒ 80px」と見積もった定数で
// 自分を持ち上げていたが、幅320px ではラベルが折り返してバーが 95px になり
// **3px 重なる**（同じ z-40 でミニプレイヤーが後に描かれるので、「公開」を
// 押したつもりでプレイヤーのボタンが反応する）。見積もりをやめて測る。

function Bar({ height }: { height: number }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useBottomBarHeight(ref);
    return <div ref={ref} data-testid="bar" style={{ height }} />;
}

/** jsdom はレイアウトを計算しないので offsetHeight を差し替える */
function stubHeights(px: number) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true, get() { return px; },
    });
}

afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--bottom-bar-h");
    vi.unstubAllGlobals();
});

describe("固定バーの高さを CSS 変数に出す", () => {
    it("実際の高さを出す（決め打ちではない）", () => {
        stubHeights(95);
        render(<Bar height={95} />);
        expect(document.documentElement.style.getPropertyValue("--bottom-bar-h"),
            "決め打ちの値になっている（幅320px でバーは 95px になる）").toBe("95px");
    });

    // バーの無いページでミニプレイヤーが宙に浮かないように、必ず消す
    it("バーが消えたら変数も消す", () => {
        stubHeights(80);
        const { unmount } = render(<Bar height={80} />);
        expect(document.documentElement.style.getPropertyValue("--bottom-bar-h")).toBe("80px");
        unmount();
        expect(document.documentElement.style.getPropertyValue("--bottom-bar-h"),
            "バーが無いのに持ち上げたままになる").toBe("");
    });

    // 高さが変わったら追随する（ラベルの折り返し・文字サイズ設定）
    it("ResizeObserver で高さの変化に追随する", () => {
        stubHeights(80);
        const box: { trigger: (() => void) | null } = { trigger: null };
        vi.stubGlobal("ResizeObserver", class {
            constructor(cb: () => void) { box.trigger = cb; }
            observe() { }
            disconnect() { }
        });
        render(<Bar height={80} />);
        expect(document.documentElement.style.getPropertyValue("--bottom-bar-h")).toBe("80px");

        stubHeights(95);
        box.trigger?.();
        expect(document.documentElement.style.getPropertyValue("--bottom-bar-h"),
            "高さが変わっても古い値のまま").toBe("95px");
    });

    // ResizeObserver が無い環境でも、少なくとも1回は測る
    it("ResizeObserver が無くても1回は測る", () => {
        stubHeights(88);
        vi.stubGlobal("ResizeObserver", undefined);
        render(<Bar height={88} />);
        expect(document.documentElement.style.getPropertyValue("--bottom-bar-h")).toBe("88px");
    });
});

// MiniPlayer 側がその変数を読んでいること（定数とページ一覧に戻っていないこと）
describe("MiniPlayer は測った値を使う", () => {
    it("--bottom-bar-h を読み、決め打ちの定数を持たない", async () => {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const code = readFileSync(join(process.cwd(), "app/components/MiniPlayer.tsx"), "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, " ")
            .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
        expect(code, "測った値を読んでいない").toContain("var(--bottom-bar-h");
        expect(code, "決め打ちの高さが戻っている").not.toContain("BOTTOM_BAR_HEIGHT_PX");
        expect(code, "ページ名の一覧が戻っている（足し忘れると静かに重なる）")
            .not.toContain("PAGES_WITH_BOTTOM_BAR");
    });
});
