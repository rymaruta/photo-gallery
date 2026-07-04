import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// exifr をモック
const mockParse = vi.hoisted(() => vi.fn());
vi.mock("exifr", () => ({ default: { parse: mockParse } }));

import { extractExifFromFile, reverseGeocode } from "../exif";

beforeEach(() => {
    mockParse.mockReset();
    vi.restoreAllMocks();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("extractExifFromFile", () => {
    const dummyFile = new File([new Uint8Array([1, 2, 3]) as BlobPart], "p.jpg", { type: "image/jpeg" });

    it("撮影日時・GPS・カメラ情報を抽出する", async () => {
        mockParse.mockResolvedValue({
            DateTimeOriginal: new Date("2026-05-01T09:30:00Z"),
            latitude: 35.6586,
            longitude: 139.7454,
            Make: " Sony ",
            Model: "ILCE-7M4",
        });
        const meta = await extractExifFromFile(dummyFile);
        expect(meta.dateTimeOriginal).toBe("2026-05-01T09:30:00.000Z");
        expect(meta.latitude).toBe(35.6586);
        expect(meta.longitude).toBe(139.7454);
        expect(meta.cameraMake).toBe("Sony");
        expect(meta.cameraModel).toBe("ILCE-7M4");
    });

    it("DateTimeOriginal が無ければ CreateDate を使う", async () => {
        mockParse.mockResolvedValue({ CreateDate: new Date("2026-01-02T00:00:00Z") });
        const meta = await extractExifFromFile(dummyFile);
        expect(meta.dateTimeOriginal).toBe("2026-01-02T00:00:00.000Z");
    });

    it("緯度・経度は両方数値のときだけ採用する", async () => {
        mockParse.mockResolvedValue({ latitude: 35.0 }); // longitude 欠落
        const meta = await extractExifFromFile(dummyFile);
        expect(meta.latitude).toBeUndefined();
        expect(meta.longitude).toBeUndefined();
    });

    it("EXIF なし・パース失敗は空オブジェクト", async () => {
        mockParse.mockResolvedValue(undefined);
        expect(await extractExifFromFile(dummyFile)).toEqual({});
        mockParse.mockRejectedValue(new Error("broken"));
        expect(await extractExifFromFile(dummyFile)).toEqual({});
    });

    it("不正な日付オブジェクトは無視する", async () => {
        mockParse.mockResolvedValue({ DateTimeOriginal: new Date("invalid") });
        const meta = await extractExifFromFile(dummyFile);
        expect(meta.dateTimeOriginal).toBeUndefined();
    });
});

describe("reverseGeocode", () => {
    function stubFetch(response: unknown, ok = true) {
        const fetchMock = vi.fn().mockResolvedValue({
            ok,
            json: async () => response,
        });
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    it("座標を約1km精度に丸め、市区町村レベル(zoom=10)で問い合わせる", async () => {
        const fetchMock = stubFetch({ address: { city: "京都市", state: "京都府", country: "日本" } });
        await reverseGeocode(35.011636, 135.768029, "ja");
        const url = String(fetchMock.mock.calls[0][0]);
        expect(url).toContain("lat=35.01");
        expect(url).toContain("lon=135.77");
        expect(url).toContain("zoom=10");
        expect(url).toContain("accept-language=ja");
        // 丸め前の生の座標がURLに含まれないこと（プライバシー）
        expect(url).not.toContain("35.011636");
        expect(url).not.toContain("135.768029");
    });

    it("市区町村・都道府県・国を結合して返す", async () => {
        stubFetch({ address: { city: "京都市", state: "京都府", country: "日本" } });
        expect(await reverseGeocode(35.01, 135.77, "ja")).toBe("京都市, 京都府, 日本");
    });

    it("city が無ければ town / village などにフォールバックする", async () => {
        stubFetch({ address: { village: "白川村", state: "岐阜県", country: "日本" } });
        expect(await reverseGeocode(36.27, 136.9, "ja")).toBe("白川村, 岐阜県, 日本");
    });

    it("address が空なら display_name を返す", async () => {
        stubFetch({ display_name: "Somewhere, Earth" });
        expect(await reverseGeocode(0, 0, "en")).toBe("Somewhere, Earth");
    });

    it("HTTPエラー・例外は null", async () => {
        stubFetch({}, false);
        expect(await reverseGeocode(35, 135, "ja")).toBeNull();
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
        expect(await reverseGeocode(35, 135, "ja")).toBeNull();
    });
});
