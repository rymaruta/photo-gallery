import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 🔴 **チップが密すぎて、隣を押してしまう**（WCAG 2.2 SC 2.5.8・AA）。
 *
 * タグ・カテゴリのチップは `py-0.5`＝**高さ18px**。24px 未満の対象は
 * 「24px の円が他の対象の円と重ならなければ適合」という**間隔の例外**が
 * 使えるが、`gap-1.5` は root が 14px（このサイトは 640px 未満で 14px に
 * 固定）なので **5.25px**——**行の間隔が22px**になり、上下の行の円が重なる。
 *
 * **実測（本物のビルドを Chromium で開き、24px の円で数えた）**:
 *
 *     ページ                    320px          393px
 *     /photo/<タグ8枚>          **2件 重なる**   0件（行が減る）
 *     /user/edit（チップ12個）   **6件**        **4件**
 *     /user/upload               **4件**        **6件**
 *     /（トップ）・/tag/*・/map    0件           0件
 *
 * **320px はいちばん小さいスマホ**（iPhone SE など）で、写真ページは
 * 検索から来た人が最初に着く画面。
 *
 * 直したのは**間隔だけ**（`gap-1.5` → `gap-2`）。チップの大きさも文字も
 * 変えていない——行の間隔が 22 → 24px になり、実測で全部 0件。
 * 箱の高さは 40 → 42px（2行のとき +2px）。
 *
 * ⚠️ **`py-0.5` のチップの行を、`gap-1.5` 以下に戻さないこと。**
 * jsdom はレイアウトを計算しないので、ここは**指定が付いていること**を見る
 * （数値の根拠は上の実測。測り直す道具は
 *  `scripts/__tests__` ではなく実ブラウザが要る）。
 */

/** `py-0.5`（高さ18px）のチップを含む、折り返す行 */
const CHIP_ROWS = [
    ["app/photo/[id]/PhotoPageClient.tsx", "写真ページのタグ（公開・検索の着地点）"],
    ["app/user/edit/page.tsx", "編集画面のカテゴリとタグ"],
    ["app/user/upload/page.tsx", "アップロード画面のカテゴリとタグ"],
] as const;

const read = (p: string) => readFileSync(p, "utf8");
/** コメントを落としてから走査する（説明文の `gap-1.5` に一致させない） */
const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("チップの行の間隔（24px の円が重ならないこと）", () => {
    it.each(CHIP_ROWS)("%s に gap-1.5 以下の折り返す行が無い", (file) => {
        const src = strip(read(file));
        const tight = [...src.matchAll(/className="[^"]*flex-wrap[^"]*"/g)]
            .map((m) => m[0])
            .filter((c) => /\bgap-(?:0|0\.5|1|1\.5|x-1\.5)\b/.test(c));
        expect(tight, `詰まりすぎている行:\n${tight.join("\n")}`).toEqual([]);
    });

    // **チップの高さを変えたら、この判定の前提が変わる。**
    // `py-1`（21px）以上にすれば `gap-1.5` でも間隔は足りる
    it.each(CHIP_ROWS)("%s のチップは py-0.5（＝18px・前提）", (file) => {
        const src = strip(read(file));
        expect(src, "チップの高さが変わった。行の間隔の前提を測り直すこと").toMatch(/px-2 py-0\.5 rounded-full/);
    });

    // 検出器の自己確認（いま0件なので、壊れた検出器と正しい検出器が同じ答えを返す）
    it("検出器が、詰まった行だけを見分ける", () => {
        const find = (s: string) => [...strip(s).matchAll(/className="[^"]*flex-wrap[^"]*"/g)]
            .map((m) => m[0]).filter((c) => /\bgap-(?:0|0\.5|1|1\.5|x-1\.5)\b/.test(c));
        expect(find('<div className="flex flex-wrap gap-1.5">'), "詰まった行を見逃している").toHaveLength(1);
        expect(find('<div className="flex flex-wrap gap-1">'), "gap-1 を見逃している").toHaveLength(1);
        expect(find('<div className="flex flex-wrap gap-2">'), "広い行を誤検知している").toHaveLength(0);
        expect(find('<div className="flex flex-wrap gap-2.5">'), "gap-2.5 を誤検知している").toHaveLength(0);
        expect(find('<div className="flex gap-1.5">'), "折り返さない行を誤検知している").toHaveLength(0);
        expect(find('{/* 以前は gap-1.5 だった */}\n<div className="flex flex-wrap gap-2">'), "コメントを検知している").toHaveLength(0);
    });
});
