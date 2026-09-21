import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    sanitizeExtraImages, mergeExtraImages, extraImageUrls,
    EXTRA_IMAGES_MAX, PHOTO_IMAGES_MAX,
} from "../photoImages";

/**
 * 1投稿に複数枚（owner の新デザインの「1/10」）。
 *
 * **ここが緩いと、表紙で一度塞いだ穴が2枚目以降から開く**——他人の
 * 写真の公開URLを自分の投稿に入れて、自分の投稿を消すと相手の実ファイルが
 * S3 から消える。だから検査は表紙とまったく同じ厳しさで見る。
 */

const CDN = "https://cdn.example.com";
const ME = "u1";
const OTHER = "u2";
const cover = `${CDN}/uploads/${ME}/cover.webp`;

beforeEach(() => { process.env.CLOUDFRONT_URL = CDN; });
afterEach(() => { delete process.env.CLOUDFRONT_URL; });

const img = (name: string, owner = ME) => ({ src: `${CDN}/uploads/${owner}/${name}` });

describe("sanitizeExtraImages", () => {
    it("自分のアップロード領域の写真だけ通す", () => {
        const out = sanitizeExtraImages([img("a.webp"), img("b.webp")], ME, CDN, cover);
        expect(out?.map((i) => i.src)).toEqual([
            `${CDN}/uploads/${ME}/a.webp`,
            `${CDN}/uploads/${ME}/b.webp`,
        ]);
    });

    it("🔴 他人の領域の写真は落とす（消すと相手の実ファイルが消える）", () => {
        const out = sanitizeExtraImages([img("a.webp", OTHER)], ME, CDN, cover);
        expect(out).toBeUndefined();
    });

    it("🔴 `..` を含む鍵は落とす（接頭辞だけ見ていると他人の領域へ抜けられる）", () => {
        const out = sanitizeExtraImages(
            [{ src: `${CDN}/uploads/${ME}/a.webp`, key: `uploads/${ME}/../${OTHER}/a.webp` }],
            ME, CDN, cover);
        expect(out).toBeUndefined();
    });

    it("鍵が自分の接頭辞で始まらなければ落とす", () => {
        const out = sanitizeExtraImages(
            [{ src: `${CDN}/uploads/${ME}/a.webp`, key: `uploads/${OTHER}/a.webp` }],
            ME, CDN, cover);
        expect(out).toBeUndefined();
    });

    it("表紙と同じ写真は落とす（同じ実体を2回並べない）", () => {
        const out = sanitizeExtraImages([{ src: cover }, img("a.webp")], ME, CDN, cover);
        expect(out?.map((i) => i.src)).toEqual([`${CDN}/uploads/${ME}/a.webp`]);
    });

    it("同じ写真が2回来たら1回にする", () => {
        const out = sanitizeExtraImages([img("a.webp"), img("a.webp")], ME, CDN, cover);
        expect(out).toHaveLength(1);
    });

    it(`上限 ${EXTRA_IMAGES_MAX} 枚で切る（表紙と合わせて ${PHOTO_IMAGES_MAX} 枚）`, () => {
        const many = Array.from({ length: 30 }, (_, i) => img(`a${i}.webp`));
        expect(sanitizeExtraImages(many, ME, CDN, cover)).toHaveLength(EXTRA_IMAGES_MAX);
    });

    it("1枚も通らなければ undefined（属性ごと持たない）", () => {
        expect(sanitizeExtraImages([], ME, CDN, cover)).toBeUndefined();
        expect(sanitizeExtraImages(null, ME, CDN, cover)).toBeUndefined();
        expect(sanitizeExtraImages("nope", ME, CDN, cover)).toBeUndefined();
        expect(sanitizeExtraImages([null, 1, "x"], ME, CDN, cover)).toBeUndefined();
    });

    it("500文字を超えるURLは落とす", () => {
        const long = `${CDN}/uploads/${ME}/${"a".repeat(500)}.webp`;
        expect(sanitizeExtraImages([{ src: long }], ME, CDN, cover)).toBeUndefined();
    });

    it("🔴 サムネも自分の領域だけ（外部URLだと閲覧者全員の IP が相手に渡る）", () => {
        const out = sanitizeExtraImages(
            [{ src: `${CDN}/uploads/${ME}/a.webp`, thumbSrc: "https://evil.example.com/t.webp" }],
            ME, CDN, cover);
        expect(out?.[0].thumbSrc).toBeUndefined();
        const ok = sanitizeExtraImages(
            [{ src: `${CDN}/uploads/${ME}/a.webp`, thumbSrc: `${CDN}/uploads/${ME}/t.webp` }],
            ME, CDN, cover);
        expect(ok?.[0].thumbSrc).toBe(`${CDN}/uploads/${ME}/t.webp`);
    });

    it("代表色は #rrggbb だけ", () => {
        expect(sanitizeExtraImages([{ src: `${CDN}/uploads/${ME}/a.webp`, dominantColor: "#AABBCC" }],
            ME, CDN, cover)?.[0].dominantColor).toBe("#aabbcc");
        expect(sanitizeExtraImages([{ src: `${CDN}/uploads/${ME}/a.webp`, dominantColor: "red" }],
            ME, CDN, cover)?.[0].dominantColor).toBeUndefined();
    });

    it("寸法は正の有限な数だけ", () => {
        const out = sanitizeExtraImages(
            [{ src: `${CDN}/uploads/${ME}/a.webp`, width: 1200.4, height: -3 }], ME, CDN, cover);
        expect(out?.[0].width).toBe(1200);
        expect(out?.[0].height).toBeUndefined();
        expect(sanitizeExtraImages(
            [{ src: `${CDN}/uploads/${ME}/a.webp`, width: Infinity }], ME, CDN, cover)?.[0].width)
            .toBeUndefined();
    });

    it("URL の派生（srcAvif など）は受け取らない——ビルドが作る側なので利用者から来ない", () => {
        const out = sanitizeExtraImages(
            [{ src: `${CDN}/uploads/${ME}/a.webp`, srcAvif: "https://evil.example.com/x.avif" }],
            ME, CDN, cover);
        expect(out?.[0]).toEqual({ src: `${CDN}/uploads/${ME}/a.webp` });
    });

    // **ぼかしだけは受け取る**（表紙と揃える）。URL ではなく `data:` URI なので
    // 外のホストを指しようが無い。受け取らないと、次のビルド（定期は週1）まで
    // **1枚目だけ blur-up して2枚目以降は真っ黒**になる
    it("ぼかしプレビュー（data: URI）は受け取る", () => {
        const blur = "data:image/webp;base64,UklGRg==";
        expect(sanitizeExtraImages([{ src: `${CDN}/uploads/${ME}/a.webp`, blurDataURL: blur }],
            ME, CDN, cover)?.[0].blurDataURL).toBe(blur);
    });

    it("ぼかしの形が違えば落とす（外部URLを混ぜられない）", () => {
        for (const bad of ["https://evil.example.com/x.webp", "data:text/html,<script>", "javascript:1", ""]) {
            expect(sanitizeExtraImages([{ src: `${CDN}/uploads/${ME}/a.webp`, blurDataURL: bad }],
                ME, CDN, cover)?.[0].blurDataURL, bad).toBeUndefined();
        }
    });
});

describe("mergeExtraImages（保存の再送で、ビルドが作った派生を落とさない）", () => {
    const a = `${CDN}/uploads/${ME}/a.webp`;
    const b = `${CDN}/uploads/${ME}/b.webp`;

    it("同じ src の既存要素から派生を引き継ぐ", () => {
        const merged = mergeExtraImages([{ src: a }], [{ src: a, srcAvif: "x.avif", width: 100 }]);
        expect(merged?.[0]).toEqual({ src: a, srcAvif: "x.avif", width: 100 });
    });

    it("今回の本文にある項目は今回が勝つ", () => {
        const merged = mergeExtraImages([{ src: a, width: 200 }], [{ src: a, width: 100 }]);
        expect(merged?.[0].width).toBe(200);
    });

    it("src が違えば引き継がない（差し替えた写真に前の派生を付けない）", () => {
        const merged = mergeExtraImages([{ src: b }], [{ src: a, srcAvif: "x.avif" }]);
        expect(merged?.[0]).toEqual({ src: b });
    });

    it("既存が無い・配列でないときはそのまま", () => {
        expect(mergeExtraImages([{ src: a }], undefined)?.[0]).toEqual({ src: a });
        expect(mergeExtraImages([{ src: a }], "x")?.[0]).toEqual({ src: a });
        expect(mergeExtraImages(undefined, [{ src: a }])).toBeUndefined();
    });
});

describe("extraImageUrls（削除の列挙）", () => {
    it("🔴 派生まで全部拾う（漏らすと投稿を消しても実体が公開URLに残る）", () => {
        const urls = extraImageUrls([
            { src: "s1", srcAvif: "a1", thumbSrc: "t1", thumbAvif: "ta1", thumbSm: "ts1", thumbSmAvif: "tsa1" },
            { src: "s2" },
        ]);
        expect(urls).toEqual(["s1", "a1", "t1", "ta1", "ts1", "tsa1", "s2"]);
    });

    it("配列でない・要素が壊れていても落ちない", () => {
        expect(extraImageUrls(undefined)).toEqual([]);
        expect(extraImageUrls("x")).toEqual([]);
        expect(extraImageUrls([null, 1, {}, { src: 5 }])).toEqual([]);
    });
});
