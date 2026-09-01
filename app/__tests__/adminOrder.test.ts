import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **管理画面の並びが、サイト側と違う規則のまま残っていた。**
//
// `app/admin/page.tsx` は `Date.parse(p.date ?? p.updatedAt ?? p.createdAt ?? "")`
// で並べており、
//   - `??` は空文字を拾わないので、撮影日を空にした写真は更新日を持っていても
//     キーが 0 になり最下段へ落ちる
//   - `Date.parse` はゾーン無しの `T` 形式をローカル・日付だけを UTC と解釈するので、
//     並びが閲覧者のタイムゾーンで変わる（実測で JST と UTC が逆になる組がある）
// の2つを持っていた。規則は `lib/utils/photoOrder.ts` の1本に寄せてある。
//
// この画面は認証・API・トーストが絡んで単体で描けないので、ここでは
// **「自前で日付を解釈していないこと」**を見る（並び方そのものの検証は
// `lib/utils/__tests__/photoOrder.test.ts` の `compareAdmin` にある）。
describe("管理画面は並びの規則を自前で持たない", () => {
    const src = readFileSync(join(process.cwd(), "app/admin/page.tsx"), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));

    it("並べ替えは compareAdmin に任せる", () => {
        const sorts = code.filter((l) => l.includes(".sort("));
        expect(sorts.length, "並べ替えが複数ある（規則が2つに割れている）").toBe(1);
        expect(sorts[0]).toContain("compareAdmin(");
    });

    it("日付の解釈を自前で書かない（Date.parse / new Date）", () => {
        const parsing = code.filter((l) => /Date\.parse\(|new Date\(/.test(l));
        expect(parsing, "自前で日付を解釈している行が残っている").toEqual([]);
    });
});
