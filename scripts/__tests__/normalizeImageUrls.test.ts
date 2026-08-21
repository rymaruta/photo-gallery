import { describe, it, expect, beforeAll } from "vitest";

// スクリプトは読み込んだ時点で環境を要求する（未設定なら止める作り）。
// require しただけで本番のテーブルを触らないよう、実行は require.main で
// 区切ってある。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let normalizeUrl: any, changesFor: any, URL_FIELDS: string[];
beforeAll(() => {
    process.env.PHOTOS_TABLE = "photos-test";
    process.env.PUBLIC_BASE_URL = "https://journey-photo.com";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ normalizeUrl, changesFor, URL_FIELDS } = require("../normalize-image-urls.js"));
});

// サムネ生成が CloudFront の既定ドメインを URL の土台にしていた時期があり、
// 同じサイトの画像が2つのホスト名で保存された（実測30件中11件）。
// サイトマップが両方を <image:loc> に載せるのでインデックスが2ホストに割れる。
// 以後の書き込みは直したので、これは既に保存されているぶんの後片付け。

const BASE = "https://journey-photo.com";
const OLD = ["d1s3dwwzgxf5ni.cloudfront.net"];

describe("normalizeUrl", () => {
    it("古いホストを配信URLに揃える", () => {
        expect(normalizeUrl("https://d1s3dwwzgxf5ni.cloudfront.net/uploads/u1/a.jpg", BASE, OLD))
            .toBe("https://journey-photo.com/uploads/u1/a.jpg");
    });

    it("既に揃っているものは触らない（冪等）", () => {
        expect(normalizeUrl("https://journey-photo.com/uploads/u1/a.jpg", BASE, OLD)).toBeNull();
    });

    // **パスは変えない。** ここでエンコードし直すと、保存時の検証と食い違って
    // 削除の対象から外れる余地が生まれる（このリポジトリが過去に踏んだ形）。
    it("パスとクエリはそのまま（エンコードし直さない）", () => {
        expect(normalizeUrl("https://d1s3dwwzgxf5ni.cloudfront.net/up%6Coads/u1/%E6%B5%B7.jpg?v=2", BASE, OLD))
            .toBe("https://journey-photo.com/up%6Coads/u1/%E6%B5%B7.jpg?v=2");
    });

    it("指定していないホストは触らない（他所の画像を書き換えない）", () => {
        expect(normalizeUrl("https://example.com/uploads/a.jpg", BASE, OLD)).toBeNull();
    });

    it("OLD_HOSTS が空なら、配信URL以外を全部揃える", () => {
        expect(normalizeUrl("https://example.com/uploads/a.jpg", BASE, []))
            .toBe("https://journey-photo.com/uploads/a.jpg");
    });

    it("URL でないもの・http(s) でないものは触らない", () => {
        for (const v of ["", "uploads/a.jpg", "data:image/png;base64,xx", undefined, null, 5]) {
            expect(normalizeUrl(v, BASE, OLD)).toBeNull();
        }
    });
});

describe("changesFor", () => {
    it("派生画像も含めて揃える（原本・サムネ・AVIF）", () => {
        const item = {
            id: "p1",
            src: `https://d1s3dwwzgxf5ni.cloudfront.net/uploads/u1/a.jpg`,
            srcOriginal: `https://d1s3dwwzgxf5ni.cloudfront.net/uploads/u1/a-orig.jpg`,
            thumbSrc: `https://journey-photo.com/uploads/u1/a-thumb.webp`,   // 既に揃っている
            caption: "本文は触らない",
        };
        const out = changesFor(item, BASE, OLD);
        expect(Object.keys(out).sort()).toEqual(["src", "srcOriginal"]);
        expect(out.src).toBe("https://journey-photo.com/uploads/u1/a.jpg");
    });

    it("揃えるフィールドは削除経路と同じ並び（消し残しを作らない）", () => {
        expect(URL_FIELDS).toContain("srcOriginal");   // GPS 入りの原本
        expect(URL_FIELDS).toContain("thumbSm");
        expect(URL_FIELDS).toContain("srcAvif");
    });

    it("URLを持たない管理用文書は対象にならない", () => {
        expect(changesFor({ id: "notifs#u1", items: [] }, BASE, OLD)).toEqual({});
    });
});
