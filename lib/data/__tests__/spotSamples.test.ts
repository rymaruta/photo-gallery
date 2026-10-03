import { describe, it, expect } from "vitest";
import rawLedger from "../../../content/spots.json";
import rawSamples from "../../../content/spot-samples.json";
import type { Spot } from "../spots";
import {
    toSpotSample, spotSamples, sampleLicenseKind, sampleImageObject,
    type SpotSampleRecord, type SpotSamplesFile,
} from "../spotSamples";
import { isPublished } from "../../utils/spotGuide";
import { commonsThumbAt, commonsSrcSet } from "../../utils/commonsThumb";

/**
 * **撮影地の作例（`content/spot-samples.json`）の読み込み。**
 *
 * 画面とアプリに渡る1枚は、必ず作者・ライセンス・出典（Commons のページ）を持つ。
 * 欠けた1枚・使えないライセンスの1枚は、ここで落ちる（画面が表示を忘れる余地を作らない）。
 */

const REC: SpotSampleRecord = {
    file: "File:A.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
    thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/1280px-A.jpg",
    width: 1280, height: 853,
    author: "撮った人",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    dateTimeOriginal: "2014-03-17 15:46:26",
    pickedBy: "auto",
};

/** 本物の台帳の公開済みの1件（公開の門 `isPublished` を作り物で通す手間を省く） */
const SPOT = (rawLedger as unknown as Spot[]).find((s) => s.slug === "kinkakuji")!;

describe("1枚を表示の形へ", () => {
    it("作者・ライセンス・ライセンスの文面・出典・寸法を運ぶ", () => {
        expect(toSpotSample(REC)).toEqual({
            src: REC.thumbUrl, width: 1280, height: 853, author: "撮った人",
            license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
            sourceUrl: REC.pageUrl, takenAt: "2014-03-17 15:46:26",
        });
    });

    it("🔴 NC（商用不可）・ND（改変不可）・その他のライセンスは落とす", () => {
        for (const license of ["CC BY-NC 2.0", "CC BY-ND 4.0", "CC BY-NC-SA 4.0", "CC-BY-NC-ND-3.0", "GFDL", "All rights reserved", ""]) {
            expect(toSpotSample({ ...REC, license }), license).toBeUndefined();
        }
    });

    it("書き方の揺れ（CC-BY-SA-3.0）は許し、CC0・パブリックドメインは文面の URL が無くてもよい", () => {
        expect(sampleLicenseKind("CC-BY-SA-3.0")).toBe("cc-by-sa");
        expect(sampleLicenseKind("CC BY 2.0")).toBe("cc-by");
        expect(toSpotSample({ ...REC, license: "CC-BY-SA-3.0" })?.license).toBe("CC-BY-SA-3.0");
        expect(toSpotSample({ ...REC, license: "CC0", licenseUrl: undefined })).toBeTruthy();
        expect(toSpotSample({ ...REC, license: "Public domain", licenseUrl: undefined })).toBeTruthy();
    });

    it("🔴 作者が空・CC BY 系で文面の URL が無い・出典や画像が Commons でないものは落とす", () => {
        expect(toSpotSample({ ...REC, author: "  " })).toBeUndefined();
        expect(toSpotSample({ ...REC, licenseUrl: undefined })).toBeUndefined();
        expect(toSpotSample({ ...REC, pageUrl: "https://example.com/A.jpg" })).toBeUndefined();
        expect(toSpotSample({ ...REC, thumbUrl: "https://example.com/A.jpg" })).toBeUndefined();
        expect(toSpotSample({ ...REC, width: 0 })).toBeUndefined();
    });

    it("http の URL は https に上げ、作者の「( talk )」は落とす", () => {
        const s = toSpotSample({ ...REC, licenseUrl: "http://creativecommons.org/licenses/by-sa/4.0", author: "663highland ( talk )" })!;
        expect(s.licenseUrl).toBe("https://creativecommons.org/licenses/by-sa/4.0");
        expect(s.author).toBe("663highland");
    });
});

describe("スポットの作例", () => {
    const file: SpotSamplesFile = {
        [SPOT.spotId]: { slug: "s", name: "s", samples: [
            REC,
            { ...REC, file: "File:B.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:B.jpg", license: "CC BY-NC 2.0" },
            { ...REC, file: "File:C.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:C.jpg" },
            REC, // 同じ写真を2度書いても1枚
            ...[1, 2, 3, 4, 5, 6].map((i) => ({ ...REC, file: `File:D${i}.jpg`, pageUrl: `https://commons.wikimedia.org/wiki/File:D${i}.jpg` })),
        ] },
    };

    it("前提: 使うスポットは公開済み", () => {
        expect(SPOT?.status).toBe("published");
        expect(isPublished(SPOT)).toBe(true);
    });

    it("使えない1枚と重複を落とし、最大6枚", () => {
        const out = spotSamples(SPOT, { file });
        expect(out).toHaveLength(6);
        expect(out.map((s) => s.sourceUrl)).not.toContain("https://commons.wikimedia.org/wiki/File:B.jpg");
        expect(new Set(out.map((s) => s.sourceUrl)).size).toBe(6);
    });

    it("代表写真と同じ写真は出さない（exclude）", () => {
        const out = spotSamples(SPOT, { file, exclude: [REC.pageUrl] });
        expect(out.map((s) => s.sourceUrl)).not.toContain(REC.pageUrl);
        expect(out.length).toBeGreaterThan(0);
    });

    it("下書きのスポットには付けない", () => {
        expect(spotSamples({ ...SPOT, status: "review", verifiedBy: undefined, verifiedAt: undefined } as Spot, { file })).toEqual([]);
    });

    it("構造化データの ImageObject は作者・ライセンス・出典・表示の文字を必ず持つ", () => {
        expect(sampleImageObject(toSpotSample(REC)!)).toEqual({
            "@type": "ImageObject",
            contentUrl: REC.thumbUrl, width: 1280, height: 853,
            creator: { "@type": "Person", name: "撮った人" },
            creditText: "撮った人 / CC BY-SA 4.0 / Wikimedia Commons",
            license: "https://creativecommons.org/licenses/by-sa/4.0",
            acquireLicensePage: REC.pageUrl,
        });
    });
});

describe("Commons の縮小版の URL", () => {
    it("/1280px- を標準の幅に置き換える。形が違えば作らない", () => {
        expect(commonsThumbAt(REC.thumbUrl, 500)).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/500px-A.jpg");
        expect(commonsThumbAt("https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg", 500)).toBeUndefined();
        expect(commonsThumbAt("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/400px-A.jpg", 500)).toBeUndefined();
        expect(commonsSrcSet(REC.thumbUrl, 1280)).toBe(
            "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/500px-A.jpg 500w, "
            + "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/960px-A.jpg 960w, "
            + `${REC.thumbUrl} 1280w`);
    });
});

describe("リポジトリの確定ファイル", () => {
    const ledger = rawLedger as unknown as Spot[];
    const file = rawSamples as unknown as SpotSamplesFile;

    it("🔴 書いてある1枚はどれも表示の形にできる（黙って落ちる1枚が無い）", () => {
        for (const [spotId, entry] of Object.entries(file)) {
            for (const r of entry.samples) expect(toSpotSample(r), `${spotId} ${r.file}`).toBeTruthy();
        }
    });

    it("公開済みのスポットで、書いた枚数がそのまま出る", () => {
        for (const [spotId, entry] of Object.entries(file)) {
            const spot = ledger.find((s) => s.spotId === spotId)!;
            expect(spotSamples(spot, { file }).length, spot.slug).toBe(entry.samples.length);
        }
    });
});
