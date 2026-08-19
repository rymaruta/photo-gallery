import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { keyFromSrc, thumbKeyFor, derivativeKey, shouldProcess, needsThumb, needsMeta, needsDerivatives, needsShotDate, buildMetaFields, hexFromChannel } = require("../generate-thumbnails.js");

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

describe("shouldProcess / needsThumb / needsMeta", () => {
    const src = "https://cdn.example.com/uploads/p1.jpg";
    const thumbSrc = "https://cdn.example.com/uploads/p1_thumb.webp";
    const derivatives = { thumbAvif: "https://cdn/x_thumb.avif", thumbSm: "https://cdn/x_thumb_sm.webp", thumbSmAvif: "https://cdn/x_thumb_sm.avif", srcAvif: "https://cdn/x_lg.avif" };
    const fullMeta = { dominantColor: "#123456", width: 4000, height: 3000, aspectRatio: 1.3333, blurDataURL: "data:image/webp;base64,UklGRAAA", ...derivatives };

    it("thumbSrc もメタも無い写真は対象（thumb+meta）", () => {
        const p = { id: "p1", src };
        expect(needsThumb(p)).toBe(true);
        expect(needsMeta(p)).toBe(true);
        expect(shouldProcess(p)).toBe(true);
    });

    it("thumbSrc があってもメタが欠けていればメタのみ対象", () => {
        const p = { id: "p1", src, thumbSrc };
        expect(needsThumb(p)).toBe(false);
        expect(needsMeta(p)).toBe(true);
        expect(shouldProcess(p)).toBe(true);
    });

    it("一部メタだけ欠けていても対象（dominantColor 欠落）", () => {
        const p = { id: "p1", src, thumbSrc, width: 4000, height: 3000, aspectRatio: 1.3333 };
        expect(needsMeta(p)).toBe(true);
        expect(shouldProcess(p)).toBe(true);
    });

    it("thumbSrc とメタと派生が全て揃っていればスキップ（冪等）", () => {
        const p = { id: "p1", src, thumbSrc, ...fullMeta };
        expect(needsThumb(p)).toBe(false);
        expect(needsMeta(p)).toBe(false);
        expect(needsDerivatives(p)).toBe(false);
        expect(shouldProcess(p)).toBe(false);
    });

    it("派生（AVIF/256）だけ欠けていても対象", () => {
        const p = { id: "p1", src, thumbSrc, ...fullMeta, thumbAvif: "" };
        expect(needsThumb(p)).toBe(false);
        expect(needsMeta(p)).toBe(false);
        expect(needsDerivatives(p)).toBe(true);
        expect(shouldProcess(p)).toBe(true);
    });

    it("空文字のメタは未補完として扱う", () => {
        const p = { id: "p1", src, thumbSrc, ...fullMeta, dominantColor: "" };
        expect(needsMeta(p)).toBe(true);
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

describe("derivativeKey", () => {
    it("接尾辞と拡張子を付けた派生キーを作る", () => {
        expect(derivativeKey("uploads/x.jpg", "_thumb", "avif")).toBe("uploads/x_thumb.avif");
        expect(derivativeKey("uploads/x.jpg", "_thumb_sm", "webp")).toBe("uploads/x_thumb_sm.webp");
        expect(derivativeKey("uploads/x.jpg", "_lg", "avif")).toBe("uploads/x_lg.avif");
        expect(derivativeKey("a/b/c.jpeg", "_thumb_sm", "avif")).toBe("a/b/c_thumb_sm.avif");
    });
    it("thumbKeyFor は _thumb.webp（派生と整合）", () => {
        expect(thumbKeyFor("uploads/x.jpg")).toBe("uploads/x_thumb.webp");
    });
});

describe("buildMetaFields", () => {
    it("寸法・アスペクト比・支配色を組み立てる", () => {
        const m = buildMetaFields({ width: 4000, height: 3000, dominant: { r: 18, g: 52, b: 86 } });
        expect(m).toEqual({ width: 4000, height: 3000, aspectRatio: 1.3333, dominantColor: "#123456" });
    });

    it("EXIF orientation 6（90度回転）で幅・高さを入れ替える", () => {
        const m = buildMetaFields({ width: 4000, height: 3000, orientation: 6, dominant: { r: 0, g: 0, b: 0 } });
        expect(m.width).toBe(3000);
        expect(m.height).toBe(4000);
        expect(m.aspectRatio).toBe(0.75);
    });

    it("orientation 1-4 は入れ替えない", () => {
        const m = buildMetaFields({ width: 4000, height: 3000, orientation: 1, dominant: { r: 255, g: 255, b: 255 } });
        expect(m.width).toBe(4000);
        expect(m.dominantColor).toBe("#ffffff");
    });

    it("寸法が無ければ aspectRatio は付けない", () => {
        expect(buildMetaFields({ dominant: { r: 1, g: 2, b: 3 } })).toEqual({ dominantColor: "#010203" });
        expect(buildMetaFields({})).toEqual({});
    });
});

describe("hexFromChannel", () => {
    it("0-255 を 2 桁 16 進に丸める", () => {
        expect(hexFromChannel(0)).toBe("00");
        expect(hexFromChannel(255)).toBe("ff");
        expect(hexFromChannel(9)).toBe("09");
        expect(hexFromChannel(127.6)).toBe("80");
    });

    it("範囲外はクランプする", () => {
        expect(hexFromChannel(-5)).toBe("00");
        expect(hexFromChannel(300)).toBe("ff");
        expect(hexFromChannel(undefined)).toBe("00");
    });
});

describe("needsShotDate（撮影日の補完対象）", () => {
    const src = "https://cdn.example.com/uploads/p1.jpg";
    const orig = "https://cdn.example.com/uploads/originals/p1.jpeg";

    it("date が無く、EXIF付き元画像(srcOriginal)がある写真は対象", () => {
        expect(needsShotDate({ id: "p1", src, srcOriginal: orig })).toBe(true);
    });

    it("srcOriginal が無ければ対象外（圧縮済み画像にEXIFは残っていない）", () => {
        expect(needsShotDate({ id: "p1", src })).toBe(false);
    });

    it("date が既にあれば対象外（冪等）", () => {
        expect(needsShotDate({ id: "p1", src, srcOriginal: orig, date: "2024-10-12" })).toBe(false);
    });
});
