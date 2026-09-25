import { describe, it, expect } from "vitest";
import { isHevcVideo } from "../videoCodec";

// iPhone の既定の形式（HEVC）は、再生できない環境ではストーリーが黙って
// 飛ばされる。選んだ時点で知らせるための見分け（docs/ios-bug-audit-2026-09-25.md #43）。
const box = (type: string, payload: number[]): number[] => {
    const size = payload.length + 8;
    return [(size >>> 24) & 0xFF, (size >>> 16) & 0xFF, (size >>> 8) & 0xFF, size & 0xFF, ...[...type].map((c) => c.charCodeAt(0)), ...payload];
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const moov = (codec: string) => box("moov", box("trak", box("mdia", box("minf", box("stbl", box("stsd", [0, 0, 0, 0, 0, 0, 0, 1, ...box(codec, new Array(20).fill(0))]))))));
const file = (parts: number[][]) => new Blob([new Uint8Array(parts.flat())], { type: "video/quicktime" });

describe("isHevcVideo", () => {
    it("moov が先頭でも末尾でも、HEVC（hvc1 / hev1）を見分ける", async () => {
        const ftyp = box("ftyp", ascii("qt  "));
        const mdat = box("mdat", new Array(1000).fill(7));
        expect(await isHevcVideo(file([ftyp, moov("hvc1"), mdat]))).toBe(true);
        expect(await isHevcVideo(file([ftyp, mdat, moov("hev1")]))).toBe(true);
    });

    it("H.264（avc1）は HEVC と言わない", async () => {
        expect(await isHevcVideo(file([box("ftyp", ascii("isom")), moov("avc1"), box("mdat", [1, 2, 3])]))).toBe(false);
    });

    it("圧縮データ（mdat）の中に偶然 hvc1 の並びがあっても、取り違えない", async () => {
        const mdat = box("mdat", [...new Array(100).fill(0), ...ascii("hvc1"), ...new Array(100).fill(0)]);
        expect(await isHevcVideo(file([box("ftyp", ascii("isom")), mdat, moov("avc1")]))).toBe(false);
    });

    it("moov の中でも stsd 以外（stco の数値など）に偶然 hvc1 が並んでも、取り違えない", async () => {
        const stbl = box("stbl", [
            ...box("stsd", [0, 0, 0, 0, 0, 0, 0, 1, ...box("avc1", new Array(20).fill(0))]),
            ...box("stco", [0, 0, 0, 0, 0, 0, 0, 1, ...ascii("hvc1")]),
        ]);
        const m = box("moov", box("trak", box("mdia", box("minf", stbl))));
        expect(await isHevcVideo(file([box("ftyp", ascii("isom")), m]))).toBe(false);
    });

    it("壊れていても投げない（知らせないだけ）", async () => {
        expect(await isHevcVideo(new Blob([new Uint8Array([0, 0, 0, 3, 1, 2, 3, 4])]))).toBe(false);
        expect(await isHevcVideo(new Blob([]))).toBe(false);
    });
});
