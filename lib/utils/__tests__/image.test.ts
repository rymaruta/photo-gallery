import { describe, it, expect } from "vitest";
import { stripJpegExif, scaleDimensions, thumbFileName } from "../image";

// 合成 JPEG バイト列を組み立てるヘルパー
function segment(marker: number, payload: number[]): number[] {
    const len = payload.length + 2; // 長さフィールド自身を含む
    return [0xFF, marker, (len >> 8) & 0xFF, len & 0xFF, ...payload];
}

function buildJpeg({ withExif = true, withIptc = false } = {}): Uint8Array {
    const bytes: number[] = [0xFF, 0xD8]; // SOI
    // APP0 (JFIF) — 保持されるべき
    bytes.push(...segment(0xE0, [0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02]));
    if (withExif) {
        // APP1 (Exif) — 除去されるべき（GPS等のメタデータが入る場所）
        bytes.push(...segment(0xE1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xDE, 0xAD, 0xBE, 0xEF]));
    }
    if (withIptc) {
        // APP13 (IPTC) — 除去されるべき
        bytes.push(...segment(0xED, [0x50, 0x68, 0x6F, 0x74, 0x6F]));
    }
    // DQT — 保持されるべき
    bytes.push(...segment(0xDB, [0x00, 0x01, 0x02, 0x03]));
    // SOS + 画像データ + EOI — 全部保持されるべき
    bytes.push(0xFF, 0xDA, 0x00, 0x04, 0x01, 0x02); // SOS ヘッダ
    bytes.push(0x11, 0x22, 0x33); // 圧縮データ
    bytes.push(0xFF, 0xD9); // EOI
    return new Uint8Array(bytes);
}

function findMarker(buf: Uint8Array, marker: number): boolean {
    for (let i = 2; i + 1 < buf.length; i++) {
        if (buf[i] === 0xFF && buf[i + 1] === marker) return true;
        if (buf[i] === 0xFF && buf[i + 1] === 0xDA) return false; // SOS 以降は探さない
    }
    return false;
}

describe("stripJpegExif", () => {
    it("APP1 (Exif) セグメントを除去する", async () => {
        const file = new File([buildJpeg({ withExif: true }) as BlobPart], "photo.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        const out = new Uint8Array(await result.arrayBuffer());
        expect(findMarker(out, 0xE1)).toBe(false);
    });

    it("APP13 (IPTC) セグメントも除去する", async () => {
        const file = new File([buildJpeg({ withExif: true, withIptc: true }) as BlobPart], "photo.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        const out = new Uint8Array(await result.arrayBuffer());
        expect(findMarker(out, 0xE1)).toBe(false);
        expect(findMarker(out, 0xED)).toBe(false);
    });

    it("APP0/DQT/SOS/画像データは保持する", async () => {
        const src = buildJpeg({ withExif: true });
        const file = new File([src as BlobPart], "photo.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        const out = new Uint8Array(await result.arrayBuffer());
        // SOI
        expect(out[0]).toBe(0xFF);
        expect(out[1]).toBe(0xD8);
        // APP0 と DQT は残る
        expect(findMarker(out, 0xE0)).toBe(true);
        expect(findMarker(out, 0xDB)).toBe(true);
        // EOI で終わる（SOS 以降のデータ保持の確認）
        expect(out[out.length - 2]).toBe(0xFF);
        expect(out[out.length - 1]).toBe(0xD9);
    });

    it("EXIF がない JPEG はサイズ以外そのまま", async () => {
        const src = buildJpeg({ withExif: false });
        const file = new File([src as BlobPart], "clean.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        const out = new Uint8Array(await result.arrayBuffer());
        expect(out).toEqual(src);
    });

    it("JPEG 以外のファイルはそのまま返す", async () => {
        const file = new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47]) as BlobPart], "img.png", { type: "image/png" });
        const result = await stripJpegExif(file);
        expect(result).toBe(file);
    });

    it("JPEG マジックナンバーがない壊れたファイルはそのまま返す", async () => {
        const file = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03]) as BlobPart], "broken.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        const out = new Uint8Array(await result.arrayBuffer());
        expect(out).toEqual(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    });

    it("ファイル名と MIME タイプを維持する", async () => {
        const file = new File([buildJpeg() as BlobPart], "旅の写真.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        expect(result.name).toBe("旅の写真.jpg");
        expect(result.type).toBe("image/jpeg");
    });
});

describe("scaleDimensions", () => {
    it("横長画像は長辺（幅）を maxPx に合わせる", () => {
        expect(scaleDimensions(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 });
    });

    it("縦長画像は長辺（高さ）を maxPx に合わせる", () => {
        expect(scaleDimensions(3000, 4000, 1920)).toEqual({ width: 1440, height: 1920 });
    });

    it("正方形は両辺 maxPx になる", () => {
        expect(scaleDimensions(2048, 2048, 512)).toEqual({ width: 512, height: 512 });
    });

    it("maxPx 以下の画像は拡大しない", () => {
        expect(scaleDimensions(800, 600, 1920)).toEqual({ width: 800, height: 600 });
    });

    it("サムネイルサイズ（512px）への縮小", () => {
        expect(scaleDimensions(1920, 1080, 512)).toEqual({ width: 512, height: 288 });
    });

    it("端数は四捨五入される", () => {
        const { height } = scaleDimensions(1000, 333, 512);
        expect(height).toBe(Math.round(333 * 512 / 1000));
    });
});

describe("thumbFileName", () => {
    it("拡張子を差し替えて _thumb を付ける", () => {
        expect(thumbFileName("photo.jpg", "webp")).toBe("photo_thumb.webp");
    });

    it("拡張子がない名前にも対応する", () => {
        expect(thumbFileName("photo", "webp")).toBe("photo_thumb.webp");
    });

    it("複数ドットは最後の拡張子のみ差し替える", () => {
        expect(thumbFileName("trip.2024.png", "jpg")).toBe("trip.2024_thumb.jpg");
    });

    it("日本語ファイル名も維持する", () => {
        expect(thumbFileName("旅の写真.jpeg", "webp")).toBe("旅の写真_thumb.webp");
    });
});
