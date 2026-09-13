import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * **文字を200%にすると、全ページが横に27pxあふれていた。**
 *
 * 実ブラウザで測った（390x844・ルートの `font-size` を 16→32px）:
 *
 *     修正前  7ページすべて 横あふれ 27px
 *     修正後  7ページすべて 0px（100% でも 0px のまま）
 *
 * WCAG 1.4.10（Reflow）は、拡大したときに**横スクロールを出さない**ことを
 * 求める。原因はヘッダー——アイコンもロゴも `rem` 基準なので文字を2倍に
 * すると一緒に2倍になり、1行に収まらなくなる。
 *
 * 直し方は「**どちらが譲るか**」を決めること:
 *   ロゴ側に `min-w-0 truncate`   … 縮んでよい（`min-width:auto` の既定を外す）
 *   ナビ側に `flex-shrink-0`      … 縮まない（押せるものを潰さない）
 *
 * **100% では場所が余っているので見た目は変わらない**——320/390/768/1280px の
 * どれでもロゴは切れないことを実ブラウザで確認済み。
 *
 * jsdom は CSS を評価しないので、ここでは**この2つの指定が残っているか**を見る。
 */
describe("文字を拡大したときのヘッダー", () => {
    it("ロゴは縮んでよい（min-w-0 と truncate）", () => {
        const src = readFileSync("app/layout.tsx", "utf-8");
        const logo = src.split("\n").find((l) => l.includes("tracking-tight text-white m-0"));
        expect(logo, "ロゴの行が見つからない＝この判定は空回りしている").toBeDefined();
        expect(logo, "min-w-0 が無いと flex の既定で縮まない").toContain("min-w-0");
        expect(logo, "truncate が無いとはみ出す").toContain("truncate");
    });

    it("ナビは縮まない（flex-shrink-0）", () => {
        const src = readFileSync("app/components/HeaderNav.tsx", "utf-8");
        const nav = src.split("\n").find((l) => l.includes("site-header__nav"));
        expect(nav, "ナビの行が見つからない").toBeDefined();
        expect(nav, "flex-shrink-0 が無いと押せるものが潰れる").toContain("flex-shrink-0");
    });
});
