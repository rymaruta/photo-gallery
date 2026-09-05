import { describe, it, expect, beforeAll, vi } from "vitest";

// 地名→おおよその座標の補填（地図ページの材料）。
// 本番の写真32枚に座標が1枚も無く（`diagnose` 実測）、地名は半分強に付いている。
// **GPS 由来の正確な座標は絶対に上書きしない**——それだけは書き込みの条件式
// （`attribute_not_exists(coords)`）と、対象の選び方の両方で守る。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let normalizeLocationName: any, pickCoords: any, planTargets: any, geocodeAll: any, INTERVAL_MS: number;
beforeAll(() => {
    process.env.PHOTOS_TABLE = "photos-test";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ normalizeLocationName, pickCoords, planTargets, geocodeAll, INTERVAL_MS } = require("../geocode-locations.js"));
});

describe("normalizeLocationName", () => {
    it("前後・連続・全角の空白を整える（同じ地名を1回しか引かないための鍵）", () => {
        expect(normalizeLocationName("  パリ,   フランス ")).toBe("パリ, フランス");
        expect(normalizeLocationName("東京　渋谷")).toBe("東京 渋谷");
    });
    it("大文字小文字は畳まない（表記どおり渡す方が当たる）", () => {
        expect(normalizeLocationName("Paris")).toBe("Paris");
    });
    it("文字列でなければ空", () => {
        expect(normalizeLocationName(undefined)).toBe("");
        expect(normalizeLocationName(42)).toBe("");
    });
});

describe("pickCoords", () => {
    it("先頭の結果を約1kmに丸める（アップロード側の sanitizeCoords と同じ精度）", () => {
        expect(pickCoords([{ lat: "48.8588897", lon: "2.3200410" }])).toEqual({ lat: 48.86, lng: 2.32 });
    });
    it("空・読めない・範囲外は null", () => {
        expect(pickCoords([])).toBeNull();
        expect(pickCoords(null)).toBeNull();
        expect(pickCoords([{ lat: "abc", lon: "2" }])).toBeNull();
        expect(pickCoords([{ lat: "91", lon: "2" }])).toBeNull();
    });
});

describe("planTargets（対象の選び方）", () => {
    const rows = [
        { id: "a", src: "https://x/a.jpg", location: "パリ" },                       // 対象
        { id: "b", src: "https://x/b.jpg", location: "パリ", coords: { lat: 48.86, lng: 2.35 } }, // 正確な座標あり → 触らない
        { id: "c", src: "https://x/c.jpg" },                                         // 地名なし
        { id: "d", src: "https://x/d.jpg", location: "   " },                        // 空の地名
        { id: "e", src: "https://x/e.mp4", story: true, location: "パリ" },          // ストーリー
        { id: "like#p1#u1", location: "パリ" },                                      // 管理用文書（src なし）
        { id: "f", src: "https://x/f.jpg", location: " パリ " },                    // 表記ゆれ → 同じ地名
    ];
    it("写真で・地名があり・座標が無いものだけ", () => {
        expect(planTargets(rows).map((t: { id: string }) => t.id)).toEqual(["a", "f"]);
    });
    it("**座標のある行は対象にしない**（GPS 由来の正確な値を上書きしない）", () => {
        expect(planTargets(rows).some((t: { id: string }) => t.id === "b")).toBe(false);
    });
    it("表記ゆれは同じ地名に寄せる（1回しか引かない）", () => {
        const names = new Set(planTargets(rows).map((t: { name: string }) => t.name));
        expect([...names]).toEqual(["パリ"]);
    });
});

describe("geocodeAll", () => {
    it("同じ地名は1回だけ引き、User-Agent を名乗り、1秒以上あける", async () => {
        vi.useFakeTimers();
        const calls: { url: string; ua: string | undefined }[] = [];
        const fetchImpl = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
            calls.push({ url, ua: init?.headers?.["User-Agent"] });
            return { ok: true, json: async () => [{ lat: "35.68", lon: "139.77" }] };
        });
        const p = geocodeAll(["東京", "パリ"], fetchImpl);
        await vi.advanceTimersByTimeAsync(0);
        expect(calls, "2件目を1秒待たずに投げている").toHaveLength(1);
        await vi.advanceTimersByTimeAsync(INTERVAL_MS);
        const out = await p;
        vi.useRealTimers();

        expect(calls).toHaveLength(2);
        expect(calls[0].url).toContain("q=%E6%9D%B1%E4%BA%AC");
        expect(calls[0].ua, "Nominatim の規約: 識別できる UA が要る").toMatch(/journey-photo/);
        expect(out.get("東京")).toEqual({ lat: 35.68, lng: 139.77 });
    });

    it("HTTP エラーや例外は null にして先へ進む（1つで全部を止めない）", async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 429 })
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValueOnce({ ok: true, json: async () => [{ lat: "1", lon: "2" }] });
        const p = geocodeAll(["a", "b", "c"], fetchImpl);
        await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
        const out = await p;
        vi.useRealTimers();
        expect(out.get("a")).toBeNull();
        expect(out.get("b")).toBeNull();
        expect(out.get("c")).toEqual({ lat: 1, lng: 2 });
    });
});
