import { describe, it, expect } from "vitest";
import rawLedger from "../../../content/spots.json";
import type { Spot } from "../spots";
import {
    toSpotSample, spotSamples, sampleImageObject, sampleSourceName, sourceNameOf, SAMPLE_IMAGE_ORIGINS,
    type SpotSampleRecord, type SpotSamplesFile,
} from "../spotSamples";
import { toSpotBody } from "../spotBody";

/**
 * **作例の出どころ: Flickr**（2026-10-04）。
 *
 * 行に `source: { name: "Flickr", url: <写真のページ> }` を書くと Flickr の1枚として読む。
 * `source` の無い行は今まで通り Wikimedia Commons（既存のデータは変えない）。
 * Flickr は CC BY・CC BY-SA・CC0 だけ。出典のリンクは写真のページ（Flickr の決まり）。
 */

/** Flickr の作例の例（テストだけに置く・実データには足していない） */
const FLICKR_REC: SpotSampleRecord = {
    title: "Kinkaku-ji in autumn",
    source: { name: "Flickr", url: "https://www.flickr.com/photos/example_user/53212345678/" },
    thumbUrl: "https://live.staticflickr.com/65535/53212345678_0a1b2c3d4e_b.jpg",
    width: 1024, height: 683,
    author: "Taro Example",
    license: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    dateTimeOriginal: "2023-11-20 09:12:00",
    pickedBy: "visual-review",
};

const COMMONS_REC: SpotSampleRecord = {
    file: "File:A.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
    thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/1280px-A.jpg",
    width: 1280, height: 853, author: "撮った人", license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", pickedBy: "auto",
};

const SPOT = (rawLedger as unknown as Spot[]).find((s) => s.slug === "kinkakuji")!;

describe("Flickr の1枚を表示の形へ", () => {
    it("題・作者・ライセンス・出典（写真のページ）・出どころを運ぶ", () => {
        expect(toSpotSample(FLICKR_REC)).toEqual({
            src: FLICKR_REC.thumbUrl, width: 1024, height: 683, title: "Kinkaku-ji in autumn", author: "Taro Example",
            license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
            sourceUrl: "https://www.flickr.com/photos/example_user/53212345678/",
            source: { name: "Flickr", url: "https://www.flickr.com/photos/example_user/53212345678/" },
            takenAt: "2023-11-20 09:12:00",
        });
    });

    it("CC BY・CC BY-SA・CC0 だけ。PD Mark・「著作権の制限なし」・NC・ND は落とす", () => {
        expect(toSpotSample({ ...FLICKR_REC, license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/" })).toBeTruthy();
        expect(toSpotSample({ ...FLICKR_REC, license: "CC0 1.0", licenseUrl: undefined, author: "" })?.author).toBe("作者不明");
        for (const license of ["Public Domain Mark 1.0", "Public domain", "No known copyright restrictions", "CC BY-NC 2.0", "CC BY-ND 2.0", "All rights reserved"]) {
            expect(toSpotSample({ ...FLICKR_REC, license }), license).toBeUndefined();
        }
    });

    it("CC BY 系は作者とライセンスの文面が要る", () => {
        expect(toSpotSample({ ...FLICKR_REC, author: "" })).toBeUndefined();
        expect(toSpotSample({ ...FLICKR_REC, author: "Unknown author" })).toBeUndefined();
        expect(toSpotSample({ ...FLICKR_REC, licenseUrl: undefined })).toBeUndefined();
    });

    it("出典は Flickr の写真のページ、画像は live.staticflickr.com で、写真ID が合うものだけ", () => {
        const bad: Partial<SpotSampleRecord>[] = [
            { source: { name: "Flickr", url: "https://www.flickr.com/photos/example_user/" } },
            { source: { name: "Flickr", url: "https://flickr.com/photos/example_user/53212345678/" } },
            { source: { name: "Flickr", url: "https://www.flickr.com/photos/example_user/99999999999/" } },
            { thumbUrl: "https://farm66.staticflickr.com/65535/53212345678_0a1b2c3d4e_b.jpg" },
            { thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/1280px-A.jpg" },
            { title: "  " },
            { width: 0 },
            { personality: true },
        ];
        for (const b of bad) expect(toSpotSample({ ...FLICKR_REC, ...b }), JSON.stringify(b)).toBeUndefined();
        // http は https に直す・大きさの記号が無い URL も読む
        expect(toSpotSample({ ...FLICKR_REC, source: { name: "Flickr", url: "http://www.flickr.com/photos/example_user/53212345678" } })?.sourceUrl)
            .toBe("https://www.flickr.com/photos/example_user/53212345678");
        expect(toSpotSample({ ...FLICKR_REC, thumbUrl: "https://live.staticflickr.com/65535/53212345678_0a1b2c3d4e.jpg" })).toBeTruthy();
    });

    it("知らない出どころは出さない", () => {
        expect(toSpotSample({ ...FLICKR_REC, source: { name: "Instagram" as "Flickr", url: "https://www.instagram.com/p/x/" } })).toBeUndefined();
        expect(sampleSourceName({ source: { name: "500px" as "Flickr", url: "https://500px.com/x" } })).toBeUndefined();
    });
});

describe("source の無い行は今まで通り Wikimedia Commons", () => {
    it("出どころは Commons とみなし、表示の形に source の鍵を足さない（本文の形は変わらない）", () => {
        expect(sampleSourceName(COMMONS_REC)).toBe("Wikimedia Commons");
        const s = toSpotSample(COMMONS_REC)!;
        expect("source" in s).toBe(false);
        expect(sourceNameOf(s)).toBe("Wikimedia Commons");
        // name を Commons と書いても同じ（Commons のページ・画像の決まりで読む）
        const same = toSpotSample({ ...COMMONS_REC, source: { name: "Wikimedia Commons", url: COMMONS_REC.pageUrl! } });
        expect(same).toEqual(s);
    });
});

describe("構造化データ（JSON-LD）は出どころに合わせる", () => {
    it("creditText の最後は Flickr、acquireLicensePage は写真のページ", () => {
        const o = sampleImageObject(toSpotSample(FLICKR_REC)!);
        expect(o.creditText).toBe("Taro Example / CC BY 2.0 / Flickr");
        expect(o.acquireLicensePage).toBe("https://www.flickr.com/photos/example_user/53212345678/");
        expect(o.contentUrl).toBe(FLICKR_REC.thumbUrl);
        expect(o.license).toBe("https://creativecommons.org/licenses/by/2.0/");
        expect(o.creator).toEqual({ "@type": "Person", name: "Taro Example" });
    });

    it("Commons の1枚は今まで通り", () => {
        const o = sampleImageObject(toSpotSample(COMMONS_REC)!);
        expect(o.creditText).toBe("撮った人 / CC BY-SA 4.0 / Wikimedia Commons");
        expect(o.acquireLicensePage).toBe("https://commons.wikimedia.org/wiki/File:A.jpg");
    });
});

describe("スポットの作例・アプリ向けの本文に混ぜて出す", () => {
    const file: SpotSamplesFile = { [SPOT.spotId]: { slug: SPOT.slug, name: SPOT.name, samples: [COMMONS_REC, FLICKR_REC] } };

    it("Commons と Flickr が並び、Flickr の1枚だけ source を持つ", () => {
        const shown = spotSamples(SPOT, { file });
        expect(shown.map(sourceNameOf)).toEqual(["Wikimedia Commons", "Flickr"]);
        expect(shown[1].source).toEqual({ name: "Flickr", url: FLICKR_REC.source!.url });
        // 代表写真と同じ写真は2度出さない（Flickr の写真のページで見る）
        expect(spotSamples(SPOT, { file, exclude: [FLICKR_REC.source!.url] }).map(sourceNameOf)).toEqual(["Wikimedia Commons"]);
    });

    it("アプリ向けの本文（/app/data/spots/<slug>.json）にも同じ形で入る", () => {
        const body = toSpotBody(SPOT, file)!;
        expect(body.samples?.[1]).toMatchObject({
            sourceUrl: FLICKR_REC.source!.url,
            source: { name: "Flickr", url: FLICKR_REC.source!.url },
        });
        expect(body.samples?.[0]).not.toHaveProperty("source");
    });

    it("読み込み元は許可リスト（upload.wikimedia.org・live.staticflickr.com）のどれか", () => {
        expect([...SAMPLE_IMAGE_ORIGINS]).toEqual(["https://upload.wikimedia.org", "https://live.staticflickr.com"]);
        for (const s of spotSamples(SPOT, { file })) expect(SAMPLE_IMAGE_ORIGINS).toContain(new URL(s.src).origin);
    });
});
