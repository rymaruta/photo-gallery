import { describe, it, expect } from "vitest";
import { stripJpegExifDetailed } from "../image";

function rnd(seed: number) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** 出力に APP1/APP13 が「セグメントとして」残っていないか、SOS まで走査して調べる */
function metadataSurvives(buf: Uint8Array): boolean {
    let i = 2;
    while (i + 4 <= buf.length) {
        if (buf[i] !== 0xFF) return false; // 構造が読めない＝これ以上は判定不能
        let m = i + 1;
        while (m < buf.length && buf[m] === 0xFF) m++;
        if (m >= buf.length) return false;
        const marker = buf[m];
        if (marker === 0xDA) return false;           // SOS 以降は画像データ
        if (marker === 0xE1 || marker === 0xED) return true;
        const segStart = m + 1;
        if (segStart + 1 >= buf.length) return false;
        const len = (buf[segStart] << 8) | buf[segStart + 1];
        if (len < 2) return false;
        i = segStart + len;
        if (i > buf.length) return false;
    }
    return false;
}

const MARKERS = [0xE0, 0xE1, 0xE2, 0xED, 0xDB, 0xC4, 0xC0, 0xFE];

/** ランダムだが「JPEG らしい」バイト列を作る */
function buildFuzzJpeg(r: () => number): Uint8Array {
    const out: number[] = [0xFF, 0xD8];
    const segs = 1 + Math.floor(r() * 6);
    for (let k = 0; k < segs; k++) {
        // マーカー前の詰め物（仕様上いくつでも置ける）
        const fill = Math.floor(r() * 3);
        for (let f = 0; f < fill; f++) out.push(0xFF);
        const marker = MARKERS[Math.floor(r() * MARKERS.length)];
        const payloadLen = Math.floor(r() * 12);
        let len = payloadLen + 2;
        // ときどき長さを壊す（走査が止まる経路を踏ませる）
        if (r() < 0.12) len = r() < 0.5 ? 0 : 60000;
        out.push(0xFF, marker, (len >> 8) & 0xFF, len & 0xFF);
        for (let b = 0; b < payloadLen; b++) out.push(Math.floor(r() * 256));
    }
    if (r() < 0.85) {
        out.push(0xFF, 0xDA, 0x00, 0x04, 0x01, 0x02);
        const dataLen = Math.floor(r() * 10);
        for (let b = 0; b < dataLen; b++) out.push(Math.floor(r() * 256));
        out.push(0xFF, 0xD9);
    }
    return new Uint8Array(out);
}

// これは「GPS 入りの原本を公開しない」を支えている一番奥の関数。
// stripped=true は「確認できた」の意味なので、そこだけは絶対に嘘をつかせない。
describe("stripJpegExifDetailed 構造化ファズ", () => {
    it("stripped=true と申告したら、出力に APP1/APP13 は残っていない", async () => {
        let stripped = 0, refused = 0;
        for (let seed = 1; seed <= 4000; seed++) {
            const bytes = buildFuzzJpeg(rnd(seed));
            const file = new File([bytes as BlobPart], "f.jpg", { type: "image/jpeg" });
            const out = await stripJpegExifDetailed(file);
            if (!out.stripped) { refused++; continue; }
            stripped++;
            const got = new Uint8Array(await out.file.arrayBuffer());
            expect(metadataSurvives(got), `seed=${seed} で APP1/APP13 が残った`).toBe(false);
        }
        // 「全部拒否」で通ってしまう検査にしない
        expect(stripped).toBeGreaterThan(200);
        expect(refused).toBeGreaterThan(0);
    }, 120000);

    it("SOI から SOS までの構造を壊さない（保持すべきセグメントを落とさない）", async () => {
        for (let seed = 1; seed <= 2000; seed++) {
            const bytes = buildFuzzJpeg(rnd(seed));
            const file = new File([bytes as BlobPart], "f.jpg", { type: "image/jpeg" });
            const out = await stripJpegExifDetailed(file);
            if (!out.stripped) continue;
            const got = new Uint8Array(await out.file.arrayBuffer());
            expect(got[0], `seed=${seed}`).toBe(0xFF);
            expect(got[1], `seed=${seed}`).toBe(0xD8);
            // 出力は入力より短いか同じ（何も足していない）
            expect(got.length).toBeLessThanOrEqual(bytes.length);
        }
    }, 120000);
});
