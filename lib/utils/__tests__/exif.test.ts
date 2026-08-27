import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// exifr をモック
const mockParse = vi.hoisted(() => vi.fn());
vi.mock("exifr", () => ({ default: { parse: mockParse } }));

import { extractExifFromFile, extractCameraExif, formatCameraName, formatExposure, reverseGeocode } from "../exif";

/**
 * 本物の exifr が返すのと**同じ組み方**の Date を作る。
 *
 * exifr の reviveDate は EXIF の `"2024:11:01 07:30:00"` を
 * `new Date(year, month-1, day)` + `setHours(...)` で組む
 * （node_modules/exifr/src/dicts/tiff-revivers.mjs）。つまり実行環境の
 * **ローカル時刻**の Date になる。
 *
 * ここで `new Date("...Z")` と書いていた頃は、UTC で組んだ Date を渡して
 * いたので、実装が `toISOString()` でゾーンぶんずらしていても
 * （テストが UTC で走るぶんには）通ってしまっていた——**実物と違う前提の
 * テストが、誤った挙動を固定していた**。
 */
function exifDate(y: number, mo: number, d: number, hh = 0, mi = 0, ss = 0): Date {
    const dt = new Date(y, mo - 1, d);
    dt.setHours(hh); dt.setMinutes(mi); dt.setSeconds(ss); dt.setMilliseconds(0);
    return dt;
}

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
            DateTimeOriginal: exifDate(2026, 5, 1, 9, 30, 0),
            latitude: 35.6586,
            longitude: 139.7454,
            Make: " Sony ",
            Model: "ILCE-7M4",
        });
        const meta = await extractExifFromFile(dummyFile);
        expect(meta.dateTimeOriginal).toBe("2026-05-01T09:30:00");
        expect(meta.latitude).toBe(35.6586);
        expect(meta.longitude).toBe(139.7454);
        expect(meta.cameraMake).toBe("Sony");
        expect(meta.cameraModel).toBe("ILCE-7M4");
    });

    it("DateTimeOriginal が無ければ CreateDate を使う", async () => {
        mockParse.mockResolvedValue({ CreateDate: exifDate(2026, 1, 2) });
        const meta = await extractExifFromFile(dummyFile);
        expect(meta.dateTimeOriginal).toBe("2026-01-02T00:00:00");
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

    it("chunked(pick)で空でも、全読みフォールバックで復元する（HEIC対策）", async () => {
        // 1回目（pick）は空、2回目（chunked:false=全読み）でEXIFが取れるケース
        mockParse
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce({ DateTimeOriginal: exifDate(2026, 5, 1), Make: "Apple", Model: "iPhone 15 Pro" });
        const meta = await extractExifFromFile(dummyFile);
        expect(meta.cameraModel).toBe("iPhone 15 Pro");
        expect(meta.dateTimeOriginal).toBe("2026-05-01T00:00:00");
        // 2回目の呼び出しは chunked:false（全読み）で行われる
        expect(mockParse).toHaveBeenCalledTimes(2);
        expect(mockParse.mock.calls[1][1]).toMatchObject({ chunked: false });
    });
});

describe("extractCameraExif", () => {
    const f = new File([new Uint8Array([1, 2, 3]) as BlobPart], "p.heic", { type: "image/heic" });

    it("chunked(pick)で取れればそのまま返す（全読みはしない）", async () => {
        mockParse.mockResolvedValueOnce({ Make: "SONY", Model: "ILCE-7M3", FNumber: 4, ISO: 100 });
        const exif = await extractCameraExif(f);
        expect(exif.camera).toBe("SONY ILCE-7M3");
        expect(exif.aperture).toBe("f/4");
        expect(exif.iso).toBe(100);
        expect(mockParse).toHaveBeenCalledTimes(1);
    });

    it("chunkedで空なら全読みフォールバックでカメラ情報を復元する（HEIC対策）", async () => {
        mockParse
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce({ Make: "Apple", Model: "iPhone 15 Pro", FNumber: 1.8, FocalLength: 24 });
        const exif = await extractCameraExif(f);
        expect(exif.camera).toBe("Apple iPhone 15 Pro");
        expect(exif.aperture).toBe("f/1.8");
        expect(exif.focalLength).toBe("24mm");
        expect(mockParse).toHaveBeenCalledTimes(2);
        expect(mockParse.mock.calls[1][1]).toMatchObject({ chunked: false });
    });

    it("両方空なら空オブジェクト", async () => {
        mockParse.mockResolvedValue(undefined);
        expect(await extractCameraExif(f)).toEqual({});
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
            DateTimeOriginal: exifDate(2026, 1, 20, 7, 32, 0),
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
            dateTimeOriginal: "2026-01-20T07:32:00",
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

// exifr の pick は生タグへのフィルタとして働く。Ref タグを外すと
//   de(deg,min,sec,ref) → "S"/"W" のときだけ符号反転
// の ref が undefined になり、南緯・西経が正の値になる（＝地球の反対側）。
// このテストは exifr をモックしているので符号そのものは再現できない。
// pick に Ref が入っていることを見張るのが唯一の砦。
describe("GPS の符号（南緯・西経）", () => {
    const dummyFile = new File([new Uint8Array([1, 2, 3]) as BlobPart], "p.jpg", { type: "image/jpeg" });

    it("pick に GPSLatitudeRef / GPSLongitudeRef を含める", async () => {
        mockParse.mockResolvedValue({ latitude: 21.28, longitude: -157.83 });
        await extractExifFromFile(dummyFile);

        const options = mockParse.mock.calls[0][1] as { pick?: string[] };
        expect(options.pick).toContain("GPSLatitudeRef");
        expect(options.pick).toContain("GPSLongitudeRef");
    });

    it("負の座標（南緯・西経）をそのまま通す", async () => {
        mockParse.mockResolvedValue({ latitude: -33.87, longitude: 151.21 }); // シドニー
        const meta = await extractExifFromFile(dummyFile);
        expect(meta.latitude).toBe(-33.87);
        expect(meta.longitude).toBe(151.21);
    });

    it("西経も符号を保つ", async () => {
        mockParse.mockResolvedValue({ latitude: 21.28, longitude: -157.83 }); // ホノルル
        const meta = await extractExifFromFile(dummyFile);
        expect(meta.longitude).toBe(-157.83);
    });
});

// EXIF の撮影日時にはゾーンが無い。「その土地の壁時計」なので、
// アップロードした端末のゾーンで UTC に変換してはいけない。
// 変換していた頃は、日本（UTC+9）から上げた朝 07:30 の写真が
// `2024-10-31T22:30:00.000Z` として保存され、表示側は「保存されている
// 通りに出す」規約（photoDate.ts）なので **前日の 22:30** と出ていた。
// 年表の月の区切り・並び順・JSON-LD の dateCreated まで同じ値で決まる。
describe("撮影日時は端末のゾーンに影響されない", () => {
    const origTz = process.env.TZ;
    afterEach(() => { process.env.TZ = origTz; });

    it.each(["Asia/Tokyo", "UTC", "America/New_York", "Pacific/Kiritimati"])(
        "%s の端末から上げても、EXIF に書かれた数字がそのまま保存される",
        async (tz) => {
            process.env.TZ = tz;
            // exifr はローカル時刻で組む＝どのゾーンでも成分は EXIF の数字
            mockParse.mockResolvedValue({ DateTimeOriginal: exifDate(2024, 11, 1, 7, 30, 0) });
            const meta = await extractExifFromFile(
                new File([new Uint8Array([1]) as BlobPart], "p.jpg", { type: "image/jpeg" }));

            expect(meta.dateTimeOriginal).toBe("2024-11-01T07:30:00");
            // Z を付けない（付けると「UTC の 07:30」という別の意味になる）
            expect(meta.dateTimeOriginal).not.toContain("Z");
        });
});
