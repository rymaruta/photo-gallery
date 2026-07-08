import { describe, it, expect, vi, beforeEach } from "vitest";
import { placeQueryVariants, geocodePlace, setGeocodeMinInterval } from "../geocode";

setGeocodeMinInterval(0);

function mockFetchOnce(results: Array<{ lat: string; lon: string }>) {
    return vi.fn().mockResolvedValue({ ok: true, json: async () => results });
}

beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe("placeQueryVariants", () => {
    it("フルネームを最優先で返す", () => {
        expect(placeQueryVariants("パリ")[0]).toBe("パリ");
    });

    it("括弧つきは本体と括弧の中身も試す", () => {
        const v = placeQueryVariants("オペラ・ガルニエ（パリ）");
        expect(v[0]).toBe("オペラ・ガルニエ（パリ）");
        expect(v).toContain("オペラ・ガルニエ");
        expect(v).toContain("パリ");
    });

    it("複数語は先頭2語・先頭1語・末尾1語に段階的に縮める", () => {
        const v = placeQueryVariants("香川県 観音寺市 高屋神社");
        expect(v).toContain("香川県 観音寺市");
        expect(v).toContain("香川県");
        expect(v).toContain("高屋神社");
    });

    it("カンマ区切りにも対応する", () => {
        const v = placeQueryVariants("パリ, フランス");
        expect(v).toContain("パリ");
        expect(v).toContain("フランス");
    });
});

describe("geocodePlace", () => {
    it("Nominatim の結果を座標として返す", async () => {
        const f = mockFetchOnce([{ lat: "48.8566", lon: "2.3522" }]);
        vi.stubGlobal("fetch", f);
        const p = await geocodePlace("パリ");
        expect(p).toEqual({ lat: 48.8566, lng: 2.3522 });
        expect(f).toHaveBeenCalledTimes(1);
        expect(String(f.mock.calls[0][0])).toContain("nominatim.openstreetmap.org");
    });

    it("フルネームでヒットしなければバリエーションで再試行する", async () => {
        const f = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => [] })            // full name → miss
            .mockResolvedValueOnce({ ok: true, json: async () => [{ lat: "35", lon: "135" }] }); // variant → hit
        vi.stubGlobal("fetch", f);
        const p = await geocodePlace("存在しない場所 京都");
        expect(p).toEqual({ lat: 35, lng: 135 });
        expect(f.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("結果はキャッシュされ、2回目はネットワークを叩かない", async () => {
        const f = mockFetchOnce([{ lat: "43", lon: "141" }]);
        vi.stubGlobal("fetch", f);
        await geocodePlace("北海道");
        await geocodePlace("北海道");
        expect(f).toHaveBeenCalledTimes(1);
    });

    it("見つからない場合は null を返し、それもキャッシュされる", async () => {
        const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
        vi.stubGlobal("fetch", f);
        expect(await geocodePlace("zzz架空の地名zzz")).toBeNull();
        const calls = f.mock.calls.length;
        expect(await geocodePlace("zzz架空の地名zzz")).toBeNull();
        expect(f.mock.calls.length).toBe(calls); // 再フェッチしない
    });

    it("ネットワークエラーは null を返すがキャッシュしない（次回再試行できる）", async () => {
        const bad = vi.fn().mockRejectedValue(new Error("offline"));
        vi.stubGlobal("fetch", bad);
        expect(await geocodePlace("東京")).toBeNull();
        const ok = mockFetchOnce([{ lat: "35.68", lon: "139.76" }]);
        vi.stubGlobal("fetch", ok);
        expect(await geocodePlace("東京")).toEqual({ lat: 35.68, lng: 139.76 });
    });

    it("空文字は即 null", async () => {
        const f = mockFetchOnce([]);
        vi.stubGlobal("fetch", f);
        expect(await geocodePlace("  ")).toBeNull();
        expect(f).not.toHaveBeenCalled();
    });
});
