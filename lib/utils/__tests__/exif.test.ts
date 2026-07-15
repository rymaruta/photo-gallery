import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// exifr をモック
const mockParse = vi.hoisted(() => vi.fn());
vi.mock("exifr", () => ({ default: { parse: mockParse } }));

import { extractExifFromFile, extractCameraExif, formatCameraName, formatExposure, reverseGeocode } from "../exif";

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

describe("formatCameraName", () => {
    it("Make と Model を結合する", () => {
        expect(formatCameraName("Canon", "EOS R5")).toBe("Canon EOS R5");
    });

    it("Model が Make で始まる場合は Model のみ（SONY の重複を防ぐ）", () => {
        expect(formatCameraName("SONY", "SONY ILCE-7M3")).toBe("SONY ILCE-7M3");
        expect(formatCameraName("sony", "SONY ILCE-7M3")).toBe("SONY ILCE-7M3");
    });

    it("片方だけでも返す・両方なければ undefined", () => {
        expect(formatCameraName("SONY", undefined)).toBe("SONY");
        expect(formatCameraName(undefined, "ILCE-7M3")).toBe("ILCE-7M3");
        expect(formatCameraName(undefined, undefined)).toBeUndefined();
        expect(formatCameraName("  ", " ")).toBeUndefined();
    });
});

describe("formatExposure", () => {
    it("1秒未満は 1/x 表記", () => {
        expect(formatExposure(1 / 640)).toBe("1/640s");
        expect(formatExposure(0.5)).toBe("1/2s");
    });

    it("1秒以上は秒表記", () => {
        expect(formatExposure(2)).toBe("2s");
        expect(formatExposure(1.5)).toBe("1.5s");
    });

    it("不正値は undefined", () => {
        expect(formatExposure(0)).toBeUndefined();
        expect(formatExposure(-1)).toBeUndefined();
        expect(formatExposure(undefined)).toBeUndefined();
    });
});

describe("extractCameraExif", () => {
    it("EXIF から撮影情報を整形して返す（GPSは含めない）", async () => {
        mockParse.mockResolvedValueOnce({
            Make: "SONY", Model: "SONY ILCE-7M3", LensModel: "FE 24-70mm",
            FNumber: 4, ExposureTime: 1 / 640, ISO: 100.4, FocalLength: 70.2,
            WhiteBalance: 1, ExifImageWidth: 6000, ExifImageHeight: 4000,
            DateTimeOriginal: new Date("2026-01-20T07:32:00Z"),
        });
        const exif = await extractCameraExif(new File(["x"], "p.jpg", { type: "image/jpeg" }));
        expect(exif).toEqual({
            camera: "SONY ILCE-7M3",
            lens: "FE 24-70mm",
            aperture: "f/4",
            exposure: "1/640s",
            iso: 100,
            focalLength: "70mm",
            whiteBalance: "Manual",
            imageSize: "6000x4000",
            dateTimeOriginal: "2026-01-20T07:32:00.000Z",
        });
    });

    it("EXIF がなければ空オブジェクト", async () => {
        mockParse.mockResolvedValueOnce(undefined);
        expect(await extractCameraExif(new File(["x"], "p.jpg", { type: "image/jpeg" }))).toEqual({});
    });

    it("解析エラーでも空オブジェクト（アップロードを止めない）", async () => {
        mockParse.mockRejectedValueOnce(new Error("broken"));
        expect(await extractCameraExif(new File(["x"], "p.jpg", { type: "image/jpeg" }))).toEqual({});
    });

    it("WhiteBalance 0 は Auto になる", async () => {
        mockParse.mockResolvedValueOnce({ WhiteBalance: 0 });
        expect((await extractCameraExif(new File(["x"], "p.jpg", { type: "image/jpeg" }))).whiteBalance).toBe("Auto");
    });
});
