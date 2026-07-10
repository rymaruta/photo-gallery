import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { keyFromSrc, thumbKeyFor, shouldProcess } = require("../generate-thumbnails.js");

describe("keyFromSrc", () => {
    it("CloudFront URL から S3 キーを取り出す", () => {
        expect(keyFromSrc("https://d1s3dwwzgxf5ni.cloudfront.net/uploads/abc.jpg")).toBe("uploads/abc.jpg");
    });

    it("S3 直 URL でもパスがキーになる", () => {
        expect(keyFromSrc("https://bucket.s3.ap-northeast-1.amazonaws.com/uploads/x.png")).toBe("uploads/x.png");
    });

    it("URL エンコードを復号する", () => {
        expect(keyFromSrc("https://cdn.example.com/uploads/%E5%86%99%E7%9C%9F.jpg")).toBe("uploads/写真.jpg");
    });

    it("URL でない文字列は null", () => {
        expect(keyFromSrc("not-a-url")).toBeNull();
    });
});

describe("thumbKeyFor", () => {
    it("拡張子を webp に差し替えて _thumb を付ける", () => {
        expect(thumbKeyFor("uploads/abc.jpg")).toBe("uploads/abc_thumb.webp");
    });

    it("ディレクトリなしのキーにも対応する", () => {
        expect(thumbKeyFor("photo.png")).toBe("photo_thumb.webp");
    });

    it("拡張子がないキーにも対応する", () => {
        expect(thumbKeyFor("uploads/noext")).toBe("uploads/noext_thumb.webp");
    });

    it("深い階層でもディレクトリを維持する", () => {
        expect(thumbKeyFor("a/b/c.jpeg")).toBe("a/b/c_thumb.webp");
    });
});

describe("shouldProcess", () => {
    const src = "https://cdn.example.com/uploads/p1.jpg";

    it("thumbSrc がない写真は対象", () => {
        expect(shouldProcess({ id: "p1", src })).toBe(true);
    });

    it("thumbSrc が既にある写真はスキップ（冪等）", () => {
        expect(shouldProcess({ id: "p1", src, thumbSrc: "https://cdn.example.com/uploads/p1_thumb.webp" })).toBe(false);
    });

    it("src を持たない item（like#/go# マーカー等）はスキップ", () => {
        expect(shouldProcess({ id: "like#p1#u1" })).toBe(false);
        expect(shouldProcess(null)).toBe(false);
    });

    it("動画・GIF はスキップ", () => {
        for (const ext of ["mp4", "webm", "mov", "gif"]) {
            expect(shouldProcess({ id: "v1", src: `https://cdn.example.com/uploads/v1.${ext}` })).toBe(false);
        }
    });

    it("大文字拡張子の動画もスキップ", () => {
        expect(shouldProcess({ id: "v1", src: "https://cdn.example.com/uploads/V1.MP4" })).toBe(false);
    });

    it("URL として不正な src はスキップ", () => {
        expect(shouldProcess({ id: "p1", src: "broken" })).toBe(false);
    });
});
