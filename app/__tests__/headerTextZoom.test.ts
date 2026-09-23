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
    // 2026-09-22: `truncate` の**位置を変えた**。外側の `<p>` に掛けていたが、
    // 中身が `inline-flex` なので**省略記号が出ず、文字が途中で断ち切られて**
    // いた（実測: 文字200%・幅390px で 48px ぶん欠けて「Journey Phot」になる。
    // owner から「デザインがおかしい」と報告があったのがこれ）。
    // **縮んでよいという性質は変えていない**——縮む担当を、外側の箱から
    // 中の文字そのものへ移しただけ。実ブラウザで測り直して、通常（390/1280）は
    // 切れず、200%でも横あふれ 0px のまま「Journ…」と省略記号が出る。
    it("ロゴは縮んでよい（外の箱は min-w-0・文字が truncate）", () => {
        const src = readFileSync("app/layout.tsx", "utf-8");
        const logo = src.split("\n").find((l) => l.includes("tracking-tight text-white m-0"));
        expect(logo, "ロゴの行が見つからない＝この判定は空回りしている").toBeDefined();
        expect(logo, "min-w-0 が無いと flex の既定で縮まない").toContain("min-w-0");

        // 中の `<a>` も縮めるようにしないと、外側だけ縮んで中身があふれる
        const link = src.split("\n").find((l) => l.includes("inline-flex items-center gap-2"));
        expect(link, "ロゴのリンクの行が見つからない").toBeDefined();
        expect(link, "リンクに min-w-0 が無いと中身が縮まない").toContain("min-w-0");

        // **省略記号を出す担当は文字の `<span>`。** ここが無いと、
        // 詰まったときに単語の途中で断ち切られる（owner の報告そのもの）
        const word = src.split("\n").find((l) => l.includes(">Journey Photo</span>"));
        expect(word, "ロゴの文字の行が見つからない").toBeDefined();
        expect(word, "truncate が無いと「…」が出ずに断ち切られる").toContain("truncate");
        expect(word, "min-w-0 が無いと truncate が効かない").toContain("min-w-0");
    });

    it("ナビは縮まない（flex-shrink-0）", () => {
        const src = readFileSync("app/components/HeaderNav.tsx", "utf-8");
        const nav = src.split("\n").find((l) => l.includes("site-header__nav"));
        expect(nav, "ナビの行が見つからない").toBeDefined();
        expect(nav, "flex-shrink-0 が無いと押せるものが潰れる").toContain("flex-shrink-0");
    });
});
