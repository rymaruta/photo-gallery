import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPOTS } from "../../lib/data/spots";
import { spotIndexItems } from "../../lib/data/spotLink";
import { publishableSpots } from "../../lib/utils/spotGuide";

/**
 * 🔴 **索引（`/spots`）に台帳をそのまま渡さない。**
 *
 * `spotLedgerClientImport.test.ts` は「`"use client"` のファイルが `SPOTS` を
 * **import** していないか」を見る。ところが**props で渡す経路は素通りする**
 * ——Next はクライアント部品への props を RSC ペイロードとして**HTMLに埋め込む**
 * ので、`Spot[]` を渡すと台帳の全文がそのページに乗る。
 *
 * 実測（2026-09-24・本番と同じ環境変数で `next build`。台帳127件）:
 *
 *     out/spots.html   修正前 518,880 バイト（1件あたり 4,085）
 *                      修正後 229,861 バイト（1件あたり 1,809）  **55.7%減**
 *
 * `scripts/deploy-static-site.js` は HTML と `.txt` を
 * **`no-cache, no-store`** で配る（`isHtmlOrTxt`）ので、ここは
 * **訪問のたびに落ちるバイト**になる。`CLAUDE.md` の優先度は
 * 「SEO・表示速度・安定性」で、表示速度に直接当たる。
 *
 * ⚠️ **まだ足りない。** 1件あたり1,809バイトなので、各県30件
 * （1,410件）まで伸ばすと索引だけで**約2.4MB**になる。次の一手は
 * 都道府県での分割（`/spots` は県の一覧、県ごとに30件）。
 */
describe("撮影スポット索引のペイロード", () => {
    const pageSrc = readFileSync(join(process.cwd(), "app", "spots", "page.tsx"), "utf8");

    it("索引ページは軽い形（spotIndexItems）を渡している", () => {
        expect(pageSrc, "spotIndexItems() を使っていない").toContain("spotIndexItems()");
    });

    /**
     * **台帳をそのまま props にしていない。** 綴りで見る——`SpotIndexClient` の
     * 型を変えても、渡す側がこの形に戻れば同じ事故が起きる。
     */
    it("台帳（publishableSpots(SPOTS) / SPOTS）を props でそのまま渡していない", () => {
        const propsPass = /spots=\{\s*(publishableSpots\(\s*SPOTS\s*\)|SPOTS)\s*\}/;
        expect(propsPass.test(pageSrc), "台帳をそのまま渡している").toBe(false);
    });

    /**
     * **大きさで縛る。** 綴りだけだと、`spotIndexItems` の中身が太った日に
     * 気づけない（このリポジトリが「関数は在るが中身が変わった」で何度も
     * 踏んでいる形）。
     */
    it("索引に渡す1件は、台帳の1件よりずっと小さい", () => {
        const items = spotIndexItems();
        // 空回りの検出（台帳が空なら下の比較は意味を持たない）
        expect(items.length, "索引に渡すものが1件も無い").toBeGreaterThan(0);

        const full = JSON.stringify(publishableSpots(SPOTS)).length;
        const light = JSON.stringify(items).length;
        // 実測では 1/5 以下。太ったことに気づける線として 1/3 を置く
        expect(light, `軽い形が台帳の1/3を超えている（台帳 ${full} / 索引 ${light}）`)
            .toBeLessThan(full / 3);
    });

    /**
     * **画面が読まない項目を運ばない。** `SpotIndexClient` が使うのは
     * name / slug / region / summary / category / cover だけ。
     * ここに `description` や `highlights` が混ざったら、それは事故。
     */
    it("索引の1件に、画面が読まない重い項目が入っていない", () => {
        const heavy = ["description", "highlights", "seasonalGuide", "timeOfDayGuide",
            "compositionTips", "access", "parking", "safetyNotes", "sources",
            "aliases", "address", "createdAt", "updatedAt"] as const;
        const keys = new Set<string>();
        for (const item of spotIndexItems()) for (const k of Object.keys(item)) keys.add(k);
        expect([...heavy].filter((k) => keys.has(k)), "重い項目が索引に混ざっている").toEqual([]);
    });
});
