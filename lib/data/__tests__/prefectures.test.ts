import { describe, it, expect } from "vitest";
import {
    PREFECTURES, REGIONS, REGION_EN, OVERSEAS_SLUG,
    prefectureBySlug, prefectureByName,
} from "../prefectures";

/**
 * **`/spots/area/<slug>` の行き先を決めている表を見る。**
 *
 * ここが1字でも崩れると、その県のスポットは**どのページにも出ないまま
 * 静かに消える**（`spotAreas` が台帳の `region.prefecture` を
 * `prefectureByName` で引くため）。台帳側の見張りは `spotsLedger.test.ts`。
 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("都道府県の表（lib/data/prefectures.ts）", () => {
    it("47件ちょうどある", () => {
        expect(PREFECTURES.length).toBe(47);
    });

    it("名前もスラッグも重複していない", () => {
        const names = PREFECTURES.map((p) => p.name);
        const slugs = PREFECTURES.map((p) => p.slug);
        expect(new Set(names).size, "同じ都道府県名が2回ある").toBe(names.length);
        expect(new Set(slugs).size, "同じスラッグが2回ある").toBe(slugs.length);
    });

    it("スラッグは URL に出せる綴りで、海外の置き場とぶつからない", () => {
        const bad = PREFECTURES.filter((p) => !SLUG_RE.test(p.slug)).map((p) => p.slug);
        expect(bad, "URL に出せない綴り").toEqual([]);
        expect(PREFECTURES.map((p) => p.slug)).not.toContain(OVERSEAS_SLUG);
    });

    it("名前は「都道府県」で終わっている（綴りの揺れを止める）", () => {
        const bad = PREFECTURES
            .filter((p) => !/(都|道|府|県)$/.test(p.name))
            .map((p) => p.name);
        expect(bad, "都道府県の接尾辞が無い").toEqual([]);
    });

    it("英語名を全部持っている", () => {
        const bad = PREFECTURES.filter((p) => !p.nameEn.trim()).map((p) => p.name);
        expect(bad, "英語名が空").toEqual([]);
    });

    /** **8つの地方が全部使われている。** 空の地方があるなら、それは書き漏れ */
    it("地方は8つで、どれにも県が入っている", () => {
        expect(REGIONS.length).toBe(8);
        const empty = REGIONS.filter((r) => !PREFECTURES.some((p) => p.region === r));
        expect(empty, "県が1つも入っていない地方がある").toEqual([]);
        const noEn = REGIONS.filter((r) => !REGION_EN[r]);
        expect(noEn, "英語名の無い地方がある").toEqual([]);
    });

    it("スラッグからも名前からも引ける", () => {
        for (const p of PREFECTURES) {
            expect(prefectureBySlug(p.slug)?.name, `${p.slug} が引けない`).toBe(p.name);
            expect(prefectureByName(p.name)?.slug, `${p.name} が引けない`).toBe(p.slug);
        }
        expect(prefectureBySlug("nowhere")).toBeNull();
        expect(prefectureByName(undefined)).toBeNull();
    });
});
