import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import exifr from "exifr";
import { stripJpegExifDetailed, toUploadSafeFile } from "../image";

/**
 * **GPS を消すために EXIF を丸ごと落とすと、写真の「向き」も一緒に消える。**
 *
 * 実測（Chromium・EXIF Orientation=6 の 120x60 JPEG＝表示は 60x120 の縦位置）:
 *
 *     元のファイル        表示 60x120   ← 正しい（縦）
 *     APP1 を落とした後   表示 120x60   ← **90度倒れる**
 *     戻した後            表示 60x120   ← 正しい
 *
 * サーバー側の `scripts/generate-thumbnails.js` も `sharp().rotate()` で
 * EXIF の向きを見るので、**原本も派生も揃って倒れる**（同じ向きに間違うので
 * 画面のどこを見ても気づけない）。
 *
 * この経路が効くのは canvas での再エンコードが失敗したとき——
 * つまり**資源の足りない端末**で、スマホの縦位置の写真がそのまま該当する。
 */

/** EXIF の APP1 を組み立てる（Orientation と Make を持たせる） */
function exifApp1(orientation: number, endian: "MM" | "II" = "MM"): number[] {
    const be = endian === "MM";
    const u16 = (v: number) => (be ? [(v >> 8) & 0xFF, v & 0xFF] : [v & 0xFF, (v >> 8) & 0xFF]);
    const u32 = (v: number) => (be
        ? [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]
        : [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]);
    const make = [0x54, 0x65, 0x73, 0x74, 0x00];            // "Test\0"
    // IFD0: Make(0x010F, ASCII) と Orientation(0x0112, SHORT) の2件
    const ifd = [
        ...u16(2),
        ...u16(0x010F), ...u16(2), ...u32(make.length), ...u32(8 + 2 + 24 + 4), // Make は末尾に置く
        ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0x00, 0x00,
        ...u32(0),
    ];
    const tiff = [
        ...(be ? [0x4D, 0x4D] : [0x49, 0x49]),
        ...u16(42),
        ...u32(8),
        ...ifd,
        ...make,
    ];
    return [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
}

function segment(marker: number, payload: number[]): number[] {
    const len = payload.length + 2;
    return [0xFF, marker, (len >> 8) & 0xFF, len & 0xFF, ...payload];
}

function jpegWith(app1: number[] | null): Uint8Array {
    const b: number[] = [0xFF, 0xD8];
    b.push(...segment(0xE0, [0x4A, 0x46, 0x49, 0x46, 0x00]));      // APP0 (JFIF)
    if (app1) b.push(...segment(0xE1, app1));
    b.push(...segment(0xDB, [0x00, 0x01]));                         // DQT
    b.push(0xFF, 0xDA, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xFF, 0xD9); // SOS + データ + EOI
    return new Uint8Array(b);
}

const asFile = (u8: Uint8Array) => new File([u8 as BlobPart], "a.jpg", { type: "image/jpeg" });
const bytesOf = async (f: File) => new Uint8Array(await f.arrayBuffer());

/** 出力に残っている APP1 の開始位置（SOS より前だけ見る） */
function app1Offsets(buf: Uint8Array): number[] {
    const out: number[] = [];
    for (let i = 2; i + 1 < buf.length; i++) {
        if (buf[i] !== 0xFF) continue;
        if (buf[i + 1] === 0xDA) break;
        if (buf[i + 1] === 0xE1) out.push(i);
    }
    return out;
}

describe("向き（EXIF Orientation）を落とさない", () => {
    it.each([2, 3, 4, 5, 6, 7, 8])("keepOrientation なら向き %i が残る", async (o) => {
        const r = await stripJpegExifDetailed(asFile(jpegWith(exifApp1(o))), { keepOrientation: true });
        expect(r.stripped).toBe(true);
        expect(r.orientation).toBe(o);
        const read = await exifr.parse(await bytesOf(r.file), { tiff: true, translateValues: false });
        expect(read?.Orientation).toBe(o);
    });

    it("向きが 1 のときは APP1 を足さない（今までと同じバイト列）", async () => {
        const src = jpegWith(exifApp1(1));
        const kept = await stripJpegExifDetailed(asFile(src), { keepOrientation: true });
        const plain = await stripJpegExifDetailed(asFile(src));
        expect(app1Offsets(await bytesOf(kept.file))).toEqual([]);
        expect(await bytesOf(kept.file)).toEqual(await bytesOf(plain.file));
    });

    it("既定（指定なし）は今までどおり APP1 を1つも残さない", async () => {
        const r = await stripJpegExifDetailed(asFile(jpegWith(exifApp1(6))));
        expect(r.stripped).toBe(true);
        expect(app1Offsets(await bytesOf(r.file))).toEqual([]);
    });

    // **元のバイトは1つも運ばない。** 運ぶのは 1〜8 の数値ひとつだけで、
    // APP1 は組み立て直す。だから GPS が紛れ込む余地が無い。
    it("戻す APP1 は組み立てた36バイトだけで、元のタグは運ばない", async () => {
        const r = await stripJpegExifDetailed(asFile(jpegWith(exifApp1(6))), { keepOrientation: true });
        const out = await bytesOf(r.file);
        const at = app1Offsets(out);
        expect(at).toHaveLength(1);
        const len = ((out[at[0] + 2] << 8) | out[at[0] + 3]) + 2;
        expect(len).toBe(36);
        expect(Array.from(out.slice(at[0], at[0] + 36))).toEqual([
            0xFF, 0xE1, 0x00, 0x22,
            0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
            0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
            0x00, 0x01,
            0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,
            0x00, 6, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
        ]);
        // 元の APP1 にあった Make は消えている
        const read = await exifr.parse(out, { tiff: true });
        expect(read?.Make).toBeUndefined();
    });

    it("リトルエンディアン（II）の EXIF からも読める", async () => {
        const r = await stripJpegExifDetailed(asFile(jpegWith(exifApp1(8, "II"))), { keepOrientation: true });
        expect(r.orientation).toBe(8);
    });

    it.each([
        ["Exif の目印が無い", [0x58, 0x58, 0x58, 0x58, 0x00, 0x00, 0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 8]],
        ["TIFF の並びが不明", [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x41, 0x41, 0x00, 0x2A, 0, 0, 0, 8]],
        ["途中で切れている", [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4D, 0x4D]],
    ])("壊れた APP1 では向きを戻さない（%s）", async (_name, payload) => {
        const r = await stripJpegExifDetailed(asFile(jpegWith(payload)), { keepOrientation: true });
        expect(r.stripped).toBe(true);
        expect(r.orientation).toBeUndefined();
        expect(app1Offsets(await bytesOf(r.file))).toEqual([]);
    });

    it("範囲外の向き（0 や 9）は戻さない", async () => {
        for (const o of [0, 9]) {
            const r = await stripJpegExifDetailed(asFile(jpegWith(exifApp1(o))), { keepOrientation: true });
            expect(r.orientation, `orientation=${o}`).toBeUndefined();
            expect(app1Offsets(await bytesOf(r.file))).toEqual([]);
        }
    });
});

// **配線を見る。** 上の関数が正しくても、アップロードの入口が
// `keepOrientation` を渡さなければ本番では倒れたままになる。
describe("toUploadSafeFile は向きを保つ経路を通る", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        window.URL.createObjectURL = () => "blob:test";
        window.URL.revokeObjectURL = () => {};
        // デコードは成功する＝「読めるが canvas で作り直せない」＝バイト除去の保険が効く場面
        Object.defineProperty(window.Image.prototype, "src", {
            configurable: true,
            set(this: HTMLImageElement) {
                Object.defineProperty(this, "naturalWidth", { configurable: true, value: 60 });
                Object.defineProperty(this, "naturalHeight", { configurable: true, value: 120 });
                queueMicrotask(() => this.onload?.(new Event("load")));
            },
        });
    });
    afterEach(() => { vi.useRealTimers(); });

    it("バイト除去に落ちても、向きは残る", async () => {
        const out = await toUploadSafeFile(asFile(jpegWith(exifApp1(6))));
        const read = await exifr.parse(await bytesOf(out), { tiff: true, translateValues: false });
        expect(read?.Orientation).toBe(6);
        expect(read?.Make).toBeUndefined();
    });
});
