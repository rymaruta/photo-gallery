import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPOTS } from "../../lib/data/spots";
import { spotAreas, spotIndexItemsForArea, spotLinksById, spotRefsById } from "../../lib/data/spotLink";
import { visibleSpots } from "../../lib/utils/spotGuide";

/**
 * 🔴 **索引（`/spots`）に台帳を積まない。**
 *
 * `spotLedgerClientImport.test.ts` は「`"use client"` のファイルが `SPOTS` を
 * **import** していないか」を見る。ところが**props で渡す経路は素通りする**
 * ——Next はクライアント部品への props を RSC ペイロードとして**HTMLに埋め込む**
 * ので、`Spot[]` を渡すと台帳の全文がそのページに乗る。
 *
 * 実測（2026-09-24・本番と同じ環境変数で `next build`。台帳127件）:
 *
 *     out/spots.html   台帳をそのまま  518,880 バイト（1件あたり 4,085）
 *                      軽い形に落とす  229,861 バイト（1件あたり 1,809）
 *
 * **それでも足りなかった。** 1件 1,809 バイトなので、目標の「各県30件」
 * （約1,410件）まで伸ばすと索引1枚で**約2.4MB**になる。だから
 * **`/spots` は都道府県の一覧**にし、スポットの一覧は
 * `/spots/area/<slug>` に分けた。分けたあとを実ビルドで測った（台帳134件）:
 *
 *     out/spots.html            58,404 バイト（さらに **74.6%減**）
 *     out/spots/area/*.html     48枚。北海道 47,481 / 京都 45,283 / 東京 38,550
 *
 * 区画のページの大半は Next の外枠で、**中身は1件あたり1,809バイトのまま**
 * ——つまり30件の県でも 38KB ＋ 30×1.8KB ≒ **約92KB** で頭打ちになる。
 * **県が増えても1ページの大きさは増えない**のが、分けたことの効き目。
 *
 * `scripts/deploy-static-site.js` は HTML と `.txt` を
 * **`no-cache, no-store`** で配る（`isHtmlOrTxt`）ので、ここは
 * **訪問のたびに落ちるバイト**になる。`CLAUDE.md` の優先度は
 * 「SEO・表示速度・安定性」で、表示速度に直接当たる。
 */
describe("撮影スポット索引のペイロード", () => {
    const indexSrc = readFileSync(join(process.cwd(), "app", "spots", "page.tsx"), "utf8");
    const areaSrc = readFileSync(join(process.cwd(), "app", "spots", "area", "[area]", "page.tsx"), "utf8");

    it("`/spots` は区画の一覧（spotAreas）だけを渡している", () => {
        expect(indexSrc, "spotAreas() を使っていない").toContain("spotAreas()");
    });

    /**
     * **台帳もスポット一覧も props にしていない。** 綴りで見る——部品の型を
     * 変えても、渡す側がこの形に戻れば同じ事故が起きる。
     */
    it("`/spots` がスポットの一覧を props で渡していない", () => {
        const passesSpots = /spots=\{/;
        expect(passesSpots.test(indexSrc), "`/spots` がスポットを渡している").toBe(false);
        const passesLedger = /((publishableSpots|visibleSpots)\(\s*SPOTS\s*\)|[^a-zA-Z]SPOTS\s*\})\s*\}/;
        expect(passesLedger.test(indexSrc), "台帳をそのまま渡している").toBe(false);
    });

    it("`/spots/area/[area]` は区画ぶんだけを渡している", () => {
        expect(areaSrc, "spotIndexItemsForArea() を使っていない").toContain("spotIndexItemsForArea(");
        expect(/spots=\{\s*((publishableSpots|visibleSpots)\(\s*SPOTS\s*\)|SPOTS)\s*\}/.test(areaSrc),
            "区画のページが台帳をそのまま渡している").toBe(false);
    });

    /**
     * **大きさで縛る。** 綴りだけだと、中身が太った日に気づけない
     * （このリポジトリが「関数は在るが中身が変わった」で何度も踏んでいる形）。
     */
    it("`/spots` が運ぶのは、台帳の 1/20 未満", () => {
        const areas = spotAreas();
        // 空回りの検出（区画が0なら下の比較は意味を持たない）
        expect(areas.length, "区画が1つも無い").toBeGreaterThan(0);

        const full = JSON.stringify(visibleSpots(SPOTS)).length;
        const light = JSON.stringify(areas).length;
        expect(light, `区画の一覧が台帳の1/20を超えている（台帳 ${full} / 索引 ${light}）`)
            .toBeLessThan(full / 20);
    });

    /**
     * **1区画のページも、台帳の全文より小さい。** 分けた意味がここで効く
     * ——県が増えても1ページの大きさは増えない。
     */
    it("1区画に渡す量は、台帳全体よりはっきり小さい", () => {
        const areas = spotAreas();
        const biggest = Math.max(...areas.map((a) => JSON.stringify(spotIndexItemsForArea(a.slug)).length));
        const full = JSON.stringify(visibleSpots(SPOTS)).length;
        expect(biggest, `1区画が台帳の1/3を超えている（台帳 ${full} / 最大の区画 ${biggest}）`)
            .toBeLessThan(full / 3);
    });

    /**
     * 🔴 **`/trips` も同じ穴を持っていた。**
     *
     * `app/trips/page.tsx` は `spotLinksById()` を丸ごと `"use client"` の
     * `TripsClient` に渡していた。`spotLinksById` の docstring は
     * 「クライアントから台帳を import しない」ことを書いているが、
     * **props で渡す経路が抜けていた**——`/spots` とまったく同じ形。
     *
     * 実測（2026-09-24・台帳474件）:
     *
     *     spotLinksById()   97,043 バイト
     *     name + slug だけ  28,294 バイト   → **68,749 バイト（71%）が余分**
     *
     * 画面が読むのは `name`（項目の見出し）と `slug`（保存済みの行きたい
     * 場所との突き合わせ）の2つだけ。`/trips` の HTML も `no-store` で配る。
     */
    it("`/trips` は name と slug だけを渡している", () => {
        const tripsSrc = readFileSync(join(process.cwd(), "app", "trips", "page.tsx"), "utf8");
        expect(tripsSrc, "spotRefsById() を使っていない").toContain("spotRefsById()");
        expect(/spots=\{\s*spotLinksById\(\s*\)\s*\}/.test(tripsSrc),
            "解いた台帳をそのまま渡している").toBe(false);

        const refs = spotRefsById();
        const keys = new Set<string>();
        for (const v of Object.values(refs)) for (const k of Object.keys(v)) keys.add(k);
        expect([...keys].sort(), "name と slug 以外を運んでいる").toEqual(["name", "slug"]);

        const full = JSON.stringify(spotLinksById()).length;
        const light = JSON.stringify(refs).length;
        expect(light, `軽い形が解いた台帳の半分を超えている（${full} / ${light}）`)
            .toBeLessThan(full / 2);
    });

    /**
     * **画面が読まない項目を運ばない。** `SpotIndexClient` が使うのは
     * name / slug / region / summary / category / cover だけ。
     * ここに `description` や `highlights` が混ざったら、それは事故。
     */
    it("区画の1件に、画面が読まない重い項目が入っていない", () => {
        const heavy = ["description", "highlights", "seasonalGuide", "timeOfDayGuide",
            "compositionTips", "access", "parking", "safetyNotes", "sources",
            "aliases", "address", "createdAt", "updatedAt"] as const;
        const keys = new Set<string>();
        for (const a of spotAreas()) {
            for (const item of spotIndexItemsForArea(a.slug)) {
                for (const k of Object.keys(item)) keys.add(k);
            }
        }
        expect(keys.size, "どの区画にも1件も無い").toBeGreaterThan(0);
        expect([...heavy].filter((k) => keys.has(k)), "重い項目が索引に混ざっている").toEqual([]);
    });

    /**
     * **どのスポットも、どこかの区画のページに出る。** 県名の綴りが台帳と
     * `PREFECTURES` で1字でも違うと、そのスポットは**どのページにも出ない**
     * まま静かに消える。件数の和で見張る。
     */
    it("公開中のスポットは全部、どこかの区画に入っている", () => {
        const inAreas = spotAreas().reduce((n, a) => n + a.count, 0);
        expect(inAreas, "区画のどこにも入っていないスポットがある").toBe(visibleSpots(SPOTS).length);
    });
});
