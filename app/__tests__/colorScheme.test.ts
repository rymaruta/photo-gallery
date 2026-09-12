import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **黒地のサイトなのに、ブラウザが描く部品は明色の既定のままだった。**
 *
 * `color-scheme` の宣言がソースにも実ビルドの CSS にも **0件**。
 * UA は明色前提で描くので、`type="date"` のカレンダーアイコン・
 * `type="search"` の消去ボタン・数値の上下ボタン・自動入力の下地・
 * キャレット・スクロールバーが黒地の上で沈む。
 *
 * 実測（Chromium・入力欄は本文と同じ `bg-white/5` 相当）:
 *
 *     color-scheme なし   アイコンの最明 61 / 下地 13 → 1.79:1
 *     color-scheme: dark  アイコンの最明 255 / 下地 13 → 19.44:1
 *
 * WCAG 1.4.11（操作部品は 3:1）に届いていなかった。
 */
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("ブラウザが描く部品の配色", () => {
    it("color-scheme を宣言している", () => {
        expect(/color-scheme:\s*dark/.test(css), "color-scheme の宣言が無い（UA の部品が明色のまま）").toBe(true);
    });

    // **`html, body` に置く。** 下の階層に置くと、そこより外側
    // （スクロールバー・自動入力）に効かない
    it("html と body の規則に置いている", () => {
        const m = /html,\s*\nbody\s*\{([\s\S]*?)\}/.exec(css);
        expect(m, "html, body の規則が見つからない").toBeTruthy();
        expect(/color-scheme:\s*dark/.test(m![1]), "html, body の外に置かれている").toBe(true);
    });

    // 意匠と食い違わせない（黒地なのに light を宣言したら逆効果）
    it("暗い意匠と揃っている", () => {
        expect(/color-scheme:\s*light/.test(css), "light を宣言している").toBe(false);
    });
});
