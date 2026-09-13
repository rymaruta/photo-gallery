import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// `next/font` は vitest では動かない（`Inter is not a function`）。
// 見たいのは `viewport` の値だけなので、font だけ差し替えて本物を読む
vi.mock("next/font/google", () => ({ Inter: () => ({ className: "inter" }) }));

const { viewport } = await import("../layout");

/**
 * **マニフェストとメタタグの色を、2か所で別々に持たない。**
 *
 * `public/manifest.webmanifest` は `theme_color: "#000000"` を宣言して
 * いたのに、`<meta name="theme-color">` が**1ページも無かった**
 * （2026-09-12 に実ビルドで確認）。マニフェストの色が効くのは
 * **インストール後**で、ブラウザで見ている間のツールバーの色は
 * メタタグが決める——真っ黒なサイトの上に既定の明るいツールバーが
 * 乗っていた。
 *
 * ここで縛るのは**2つが一致していること**。片方だけ変えた日に落ちる。
 */
describe("テーマカラー", () => {
    const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf-8")) as {
        theme_color?: string; background_color?: string;
    };

    it("メタタグを出している", () => {
        expect(viewport.themeColor, "themeColor を書いていない").toBeDefined();
    });

    it("マニフェストの theme_color と一致する", () => {
        expect(String(viewport.themeColor).toLowerCase()).toBe(String(manifest.theme_color).toLowerCase());
    });

    // 背景色もマニフェスト側にある。**同じ黒**であることを確かめる
    // （起動画面とツールバーで色が割れると、開いた瞬間にちらつく）
    it("マニフェストの背景色と同じ黒", () => {
        expect(String(manifest.background_color).toLowerCase()).toBe(String(manifest.theme_color).toLowerCase());
    });
});
