import { describe, it, expect } from "vitest";
import rawLedger from "../../content/spots.json";
import type { Spot } from "../../lib/data/spots";
import { buildSpotSearchRows, toSpotSearchRow } from "../../lib/data/spotSearchFeed";
import { visibleSpots } from "../../lib/utils/spotGuide";
import * as route from "../app/data/spot-search.json/route";

/**
 * **「さがす」が読む名前だけの索引**（`/app/data/spot-search.json`）の形を固定する。
 * 画面と同じ母集合（`visibleSpots`）で、運ぶ鍵は名前まわりと地域と綴りだけ。
 */
const LEDGER = rawLedger as unknown as Spot[];

describe("撮影スポットの名前の索引", () => {
    it("母集合は画面と同じ（visibleSpots）で、銀山温泉が入っている", () => {
        const rows = buildSpotSearchRows(LEDGER);
        expect(rows.map((r) => r.s)).toEqual(visibleSpots(LEDGER).map((s) => s.slug));
        const ginzan = rows.find((r) => r.s === "ginzan-onsen");
        expect(ginzan).toMatchObject({ n: "銀山温泉", r: "ぎんざんおんせん", g: "山形県 尾花沢市" });
    });

    it("運ぶ鍵は名前まわり・地域・綴りだけ（本文・人名・出典を運ばない）", () => {
        const allowed = new Set(["s", "n", "e", "r", "a", "g"]);
        for (const row of buildSpotSearchRows(LEDGER)) {
            expect(Object.keys(row).filter((k) => !allowed.has(k)), row.s).toEqual([]);
        }
    });

    it("海外の行は国から書く・日本の行は県と市だけ", () => {
        const base = { spotId: "sp_000000000000", slug: "x", name: "x", status: "published" } as Spot;
        expect(toSpotSearchRow({ ...base, region: { country: "フランス", city: "パリ" } }).g).toBe("フランス パリ");
        expect(toSpotSearchRow({ ...base, region: { country: "日本", prefecture: "京都府", city: "京都市" } }).g).toBe("京都府 京都市");
    });

    it("route は force-static で JSON を返す", async () => {
        expect(route.dynamic).toBe("force-static");
        const res = route.GET();
        expect(res.headers.get("Content-Type")).toContain("application/json");
        expect(Array.isArray(JSON.parse(await res.text()))).toBe(true);
    });
});
