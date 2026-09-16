import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **タグの欄は2列ぶん使う。**
 *
 * 候補チップは10個以上並ぶので、半分の幅（実測 175px）だと**5行に伸びて
 * 右の列だけ縦に長くなり、左が空く**——owner の「飛び出してるレイアウトが
 * 気になる」。全幅（363px）にすると実測 **5行 → 2行**。
 *
 * **入力欄そのものは元から列に収まっていた**（実ブラウザで 393px 幅に置いて
 * 横あふれ 0px・重なり 0px を実測）。直したのは**チップの畳まれ方**で、
 * 先に測らずに「入力欄がはみ出している」と書いていたら誤りだった。
 *
 * jsdom はレイアウトを計算しないので、ここは**指定が付いていること**だけ見る
 * （幅の効果は実ブラウザで測った。その数値はこのコメントと実装側に残してある）。
 */
const SRC = readFileSync(join(process.cwd(), "app/user/edit/page.tsx"), "utf8");

describe("編集画面のタグ欄", () => {
    it("タグの欄が2列ぶんを使う", () => {
        // タグのラベルを持つ `<div>` の開始タグに `col-span-2` があること
        const m = /<div className="([^"]*)">\s*\n\s*<label className=\{labelCls\} htmlFor="edit-tags">/.exec(SRC);
        expect(m, "タグ欄の div が見つからない（構造が変わった）").toBeTruthy();
        expect(m![1]).toContain("col-span-2");
    });

    /**
     * **カテゴリも2列ぶん使う**（決まった選択肢のチップを足したため）。
     *
     * 実ブラウザ（Chromium・393px・本物のビルド済み CSS）で7個のチップを
     * 置いて測った:
     *
     *                    チップの幅  行数  セルの高さ  グリッド全体
     *     半分の列           176px    2行     108px       183px
     *     2列ぶん            365px  **1行**    85px     **160px**
     *
     * 半分だと2行に伸びるぶん**隣の「場所」のセルが 61 → 108px に引き伸ばされ、
     * 下に約47px の空きが出る**（owner の「飛び出してるレイアウトが気になる」と
     * 同じ形）。横あふれはどちらも 0px（393 = 393）。
     *
     * あわせて**撮影日をカテゴリより前に移した**——カテゴリだけ2列にすると
     * 「場所」の隣が空いて穴になるので、場所｜撮影日 で1行を埋める。
     */
    it("カテゴリの欄も2列ぶんを使う", () => {
        const m = /<div className="([^"]*)">\s*\n\s*<label className=\{labelCls\} htmlFor="edit-category">/.exec(SRC);
        expect(m, "カテゴリ欄の div が見つからない（構造が変わった）").toBeTruthy();
        expect(m![1]).toContain("col-span-2");
    });

    // 残る2つ（場所・撮影日）は1列のまま。全部広げると2列の意味が消える
    it("場所・撮影日は1列のまま", () => {
        for (const id of ["edit-location", "edit-date"]) {
            const m = new RegExp(`<div className="([^"]*)">\\s*\\n\\s*<label className=\\{labelCls\\} htmlFor="${id}">`).exec(SRC)
                ?? new RegExp(`<div>\\s*\\n\\s*<label className=\\{labelCls\\} htmlFor="${id}">`).exec(SRC);
            expect(m, `${id} の div が見つからない`).toBeTruthy();
            expect(m![1] ?? "", id).not.toContain("col-span-2");
        }
    });

    // グリッドの中身が縮めるようになっていること（`min-w-0` が無いと
    // 入力欄の固有幅で列が広がり、本当に横あふれする）
    it("グリッドの子が縮められる（min-w-0）", () => {
        expect(SRC).toContain('className="grid grid-cols-2 gap-4 [&>div]:min-w-0"');
    });
});
