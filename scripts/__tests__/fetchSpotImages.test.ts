import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
    isAllowedLicense, stripHtml, searchNames, pickCandidate, distanceKm, maxDistanceKm,
    normalizeName, cleanUrl, IMAGES_PATH, LEDGER_PATH, SAME_NAME_KM,
} from "../fetch-spot-images.mjs";

/**
 * **スポットの写真を Commons から集める道具**の判定を、固定データで縛る。
 * 通信する部分は試さない（Wikimedia の API は CI から叩かない）。
 */

describe("採ってよいライセンス", () => {
    it.each([
        "CC0", "CC0 1.0", "Public domain", "PD-self", "PD-old-70",
        "CC BY 2.5", "CC BY 4.0", "CC BY-SA 2.0", "CC BY-SA 4.0", "CC-BY-SA-3.0",
    ])("%s は採る", (s) => expect(isAllowedLicense(s)).toBe(true));

    it.each([
        "", "CC BY-NC 2.0", "CC BY-NC-SA 4.0", "CC BY-ND 2.0", "CC BY-NC-ND 4.0",
        "GFDL", "All rights reserved", "Attribution-NonCommercial",
    ])("%s は捨てる", (s) => expect(isAllowedLicense(s)).toBe(false));
});

describe("作者の欄", () => {
    it("リンクと実体参照を剥がして平文にする", () => {
        expect(stripHtml('<a href="//commons.wikimedia.org/wiki/User:X" title="User:X">663highland</a>')).toBe("663highland");
        expect(stripHtml("Big&nbsp;Ben &amp; <b>Japan</b>")).toBe("Big Ben & Japan");
    });
});

describe("検索する名前", () => {
    it("全角の括弧書きを外し、別名を足す（最大3つ・重複なし）", () => {
        expect(searchNames({ name: "清水渓流広場（濃溝の滝・亀岩の洞窟）", aliases: ["濃溝の滝", "亀岩の洞窟", "農溝の滝"] }))
            .toEqual(["清水渓流広場", "濃溝の滝", "亀岩の洞窟"]);
        expect(searchNames({ name: "鍋ヶ滝", aliases: ["鍋ヶ滝"] })).toEqual(["鍋ヶ滝"]);
    });
    it("比べる形は空白・中黒・括弧書きを落とす", () => {
        expect(normalizeName("高屋神社（本宮）")).toBe("高屋神社");
        expect(normalizeName("ポンピドゥー・センター")).toBe("ポンピドゥーセンター");
    });
});

describe("距離", () => {
    it("点の場所は 2km、広い場所は 5km", () => {
        expect(maxDistanceKm("滝")).toBe(2);
        expect(maxDistanceKm("湖沼")).toBe(5);
    });
    it("球面の距離（東京駅→皇居 約1.1km）", () => {
        const d = distanceKm({ lat: 35.6812, lng: 139.7671 }, { lat: 35.6852, lng: 139.7528 });
        expect(d).toBeGreaterThan(1.1);
        expect(d).toBeLessThan(1.5);
    });
});

describe("候補を選ぶ", () => {
    const spot = { name: "高屋神社", aliases: ["天空の鳥居"], category: "神社", coords: { lat: 34.15, lng: 133.69 } };

    it("許す距離の内で最も近いもの", () => {
        const pick = pickCandidate({ ...spot, coords: { lat: 34.1604, lng: 133.6548 } }, [
            { id: "Q1", label: "別の神社", coords: { lat: 34.161, lng: 133.655 }, image: "a.jpg" },
            { id: "Q2", label: "高屋神社", coords: { lat: 34.1604, lng: 133.6549 }, image: "b.jpg" },
        ]);
        expect(pick?.id).toBe("Q2");
        expect(pick).not.toHaveProperty("coordsMismatch");
    });

    it("🔴 台帳の座標がずれていても、名前が一致し 15km 以内なら採って印を付ける（実測: 高屋神社 3.4km）", () => {
        const pick = pickCandidate(spot, [
            { id: "Q60990941", label: "高屋神社", coords: { lat: 34.1609, lng: 133.6549 }, image: "b.jpg" },
        ]);
        expect(pick?.id).toBe("Q60990941");
        expect(pick?.coordsMismatch).toBe(true);
        expect(pick!.distanceKm).toBeGreaterThan(2);
        expect(pick!.distanceKm).toBeLessThan(SAME_NAME_KM);
    });

    it("🔴 同名でも遠い（別の県の同名の神社）は採らない", () => {
        expect(pickCandidate(spot, [
            { id: "Q11669282", label: "高屋神社 (羽曳野市)", coords: { lat: 34.5446, lng: 135.6091 }, image: "c.jpg" },
        ])).toBeNull();
    });

    it("🔴 名前が違い距離も外なら採らない・座標の無い候補は採らない", () => {
        expect(pickCandidate(spot, [
            { id: "Q9", label: "観音寺市役所", coords: { lat: 34.127, lng: 133.661 }, image: "d.jpg" },
            { id: "Q10", label: "高屋神社", coords: null, image: "e.jpg" },
        ])).toBeNull();
    });
});

describe("画像の URL", () => {
    it("追跡用の引数を落とし、配信元を upload.wikimedia.org に揃える", () => {
        expect(cleanUrl("https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0e/X.jpg/960px-X.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo"))
            .toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/X.jpg/960px-X.jpg");
    });
});

describe("content/spot-images.json（記録の形）", () => {
    const images: Record<string, Record<string, unknown>> = fs.existsSync(IMAGES_PATH)
        ? JSON.parse(fs.readFileSync(IMAGES_PATH, "utf8")) : {};
    const slugs = new Set((JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")) as { slug: string }[]).map((s) => s.slug));
    const rows = Object.entries(images);

    it("全行が台帳のスポットで、必須の鍵を持ち、ライセンスが許可の内", () => {
        for (const [slug, r] of rows) {
            expect(slugs.has(slug), slug).toBe(true);
            for (const k of ["wikidata", "file", "pageUrl", "thumbUrl", "author", "license", "method", "fetchedAt"]) {
                expect(r[k], `${slug}.${k}`).toBeTruthy();
            }
            expect(isAllowedLicense(r.license), `${slug} ${r.license}`).toBe(true);
            expect(String(r.thumbUrl)).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
        }
    });

    it("🔴 reviewedBy は null か人の名前（AI の名前は書けない）", () => {
        for (const [slug, r] of rows) {
            if (r.reviewedBy === null) continue;
            expect(typeof r.reviewedBy, slug).toBe("string");
            expect(String(r.reviewedBy), slug).not.toMatch(/claude|anthropic|gpt|openai|assistant|\bai\b|bot/i);
        }
    });
});
