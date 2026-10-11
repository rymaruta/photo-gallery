import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import rawLedger from "../../../content/spots.json";
import rawImages from "../../../content/spot-images.json";
import rawSamples from "../../../content/spot-samples.json";
import type { Spot } from "../spots";
import {
    shownSpotImage, spotCoverImage, licenseKindOf, isReviewedPick, SAMPLE_COVER_METHOD, type SpotImage,
} from "../spotImages";
import {
    coverCandidateSample, sampleCoverEntry, toSpotSample, coverImageObject, PUBLIC_DOMAIN_MARK_URL,
    type SpotSampleRecord, type SpotSamplesFile,
} from "../spotSamples";
import { isPublished } from "../../utils/spotGuide";
import { putImageRecord } from "../../../scripts/fetch-spot-images.mjs";

/**
 * **作例から代表写真を埋める**（2026-10-11・`scripts/promote-sample-covers.ts`）。
 *
 * 代表写真は「その場所の写真だと確かめた」が条件。作例のうち上げてよいのは、写真を1枚ずつ見て
 * その撮影地の景色と確かめたもの（`pickedBy` が "visual-review" か人の名前）だけ。
 */

const ledger = rawLedger as unknown as Spot[];
// 公開済みで、Wikidata の代表画像を照らしていない（＝今の門では代表写真が出ない）行を土台にする
const base: Spot = { ...ledger.find((s) => s.slug === "himeji-castle")!, aiCheck: { ...ledger.find((s) => s.slug === "himeji-castle")!.aiCheck!, imageChecked: false } };

const REC: SpotSampleRecord = {
    file: "File:Wide.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Wide.jpg",
    thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Wide.jpg/1280px-Wide.jpg",
    width: 1280, height: 853,
    author: "撮った人",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pickedBy: "visual-review",
};
const file = (...samples: SpotSampleRecord[]): SpotSamplesFile => ({ [base.spotId]: { slug: base.slug, name: base.name, samples } });

describe("上げてよい作例（coverCandidateSample）", () => {
    it("写真を見て確かめた1枚（visual-review・人の名前）は上げる", () => {
        expect(coverCandidateSample(base, file(REC))?.record).toBe(REC);
        const human = { ...REC, pickedBy: "rymaruta" };
        expect(coverCandidateSample(base, file(human))?.record).toBe(human);
    });

    it("🔴 名前の一致だけで選んだ1枚（auto）は上げない", () => {
        expect(coverCandidateSample(base, file({ ...REC, pickedBy: "auto" }))).toBeUndefined();
        expect(isReviewedPick({ pickedBy: "auto" })).toBe(false);
        expect(isReviewedPick({ pickedBy: " " })).toBe(false);
    });

    it("横長を先に。横長が無ければ最初の1枚", () => {
        const tall = { ...REC, file: "File:Tall.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:Tall.jpg", width: 853, height: 1280 };
        expect(coverCandidateSample(base, file(tall, REC))?.record).toBe(REC);
        expect(coverCandidateSample(base, file(tall))?.record).toBe(tall);
    });

    it("下書き・Commons 以外・画面に出せない1枚・人や催しが主役の1枚は上げない", () => {
        expect(coverCandidateSample({ ...base, status: "review" }, file(REC))).toBeUndefined();
        expect(coverCandidateSample(base, file({ ...REC, source: { name: "Flickr", url: "https://www.flickr.com/photos/a/1/" } }))).toBeUndefined();
        expect(coverCandidateSample(base, file({ ...REC, license: "CC BY-NC 2.0" }))).toBeUndefined();
        expect(coverCandidateSample(base, file({ ...REC, file: "File:Himeji Festival Parade.jpg" }))).toBeUndefined();
    });
});

describe("上げた行を出すか（shownSpotImage）", () => {
    const entry = (over: Partial<SpotImage> = {}): Record<string, SpotImage> => ({
        [base.slug]: {
            ...sampleCoverEntry(coverCandidateSample(base, file(REC))!, "2026-10-11"),
            local: { src: `/images/spots/${base.slug}.jpg`, width: 960, height: 640 },
            ...over,
        },
    });

    it("写真を見て確かめた作例の行は、代表写真として出す（出典・作者・ライセンスつき）", () => {
        expect(spotCoverImage(base, entry())).toMatchObject({
            src: `/images/spots/${base.slug}.jpg`,
            credit: "撮った人",
            license: "cc-by-sa",
            licenseLabel: "CC BY-SA 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
            sourceUrl: REC.pageUrl,
            verifiedPlace: true,
        });
    });

    it("🔴 auto の行・下書きには出さない（Wikidata の照合の印が立っていても）", () => {
        expect(shownSpotImage(base, entry({ pickedBy: "auto" }))).toBeUndefined();
        expect(shownSpotImage({ ...base, aiCheck: { ...base.aiCheck!, imageChecked: true } }, entry({ pickedBy: "auto" }))).toBeUndefined();
        expect(shownSpotImage({ ...base, status: "review" }, entry())).toBeUndefined();
    });

    it("パブリックドメインは根拠を添えた名前のまま、利用根拠を読める", () => {
        expect(licenseKindOf("Public domain (PD-self)")).toBe("public-domain");
        expect(licenseKindOf("CC-BY-SA-3.0")).toBe("cc-by-sa");
        expect(licenseKindOf("CC BY-NC 2.0")).toBeUndefined();
        const pd = { ...REC, license: "Public domain", licenseUrl: undefined, licenseCode: "PD-self" };
        const e = sampleCoverEntry(coverCandidateSample(base, file(pd))!, "2026-10-11");
        expect(e.license).toBe("Public domain (PD-self)");
        expect(spotCoverImage(base, { [base.slug]: { ...e, local: { src: "/x.jpg", width: 960, height: 640 } } })?.license).toBe("public-domain");
    });

    it("置き換えた Wikidata の代表画像は replaced に残す（local は持ち越さない）", () => {
        const prev = { wikidata: "Q9", file: "File:P.jpg", pageUrl: "p", thumbUrl: "t", author: "a", license: "CC0", method: "wikidata-P18", fetchedAt: "2026-09-26", reviewedBy: null, local: { src: "/l.jpg", width: 1, height: 1 } };
        const e = sampleCoverEntry(coverCandidateSample(base, file(REC))!, "2026-10-11", prev);
        expect(e.wikidata).toBe("Q9");
        expect(e.replaced).toMatchObject({ file: "File:P.jpg", method: "wikidata-P18" });
        expect(e.replaced).not.toHaveProperty("local");
        expect(e.method).toBe(SAMPLE_COVER_METHOD);
    });

    it("Wikidata の取り直し（--refresh）は、作例から上げた行を上書きしない", () => {
        const images: Record<string, SpotImage> = entry();
        putImageRecord(images, base.slug, { wikidata: "Q2", file: "File:New.jpg", method: "wikidata-P18" });
        expect(images[base.slug].method).toBe(SAMPLE_COVER_METHOD);
        expect(images[base.slug].replaced).toMatchObject({ file: "File:New.jpg" });
        const other: Record<string, unknown> = {};
        putImageRecord(other, "x", { file: "File:New.jpg" });
        expect(other.x).toEqual({ file: "File:New.jpg" });
    });
});

describe("構造化データの代表写真（coverImageObject）", () => {
    it("作者・ライセンス・出典・表示の文字を持つ ImageObject", () => {
        const cover = spotCoverImage(base, {
            [base.slug]: { ...sampleCoverEntry(coverCandidateSample(base, file(REC))!, "2026-10-11"), local: { src: "/c.jpg", width: 960, height: 640 } },
        })!;
        expect(coverImageObject(cover, "https://journey-photo.com/c.jpg")).toEqual({
            "@type": "ImageObject",
            contentUrl: "https://journey-photo.com/c.jpg",
            name: base.name,
            creator: { "@type": "Person", name: "撮った人" },
            creditText: "撮った人 / CC BY-SA 4.0 / Wikimedia Commons",
            license: "https://creativecommons.org/licenses/by-sa/4.0",
            acquireLicensePage: REC.pageUrl,
        });
    });

    it("パブリックドメインは Public Domain Mark、作者不明は creator を書かない", () => {
        const o = coverImageObject({ src: "/c.jpg", alt: "a", credit: "作者不明", license: "public-domain", checkedAt: "2026-10-11", verifiedPlace: true }, "u");
        expect(o.license).toBe(PUBLIC_DOMAIN_MARK_URL);
        expect(o).not.toHaveProperty("creator");
    });
});

describe("確定ファイルの見張り（content/spot-images.json）", () => {
    const images = rawImages as unknown as Record<string, SpotImage>;
    const samples = rawSamples as unknown as SpotSamplesFile;
    const bySlug = new Map(ledger.map((s) => [s.slug, s]));
    const promoted = Object.entries(images).filter(([, v]) => v.method === SAMPLE_COVER_METHOD);

    it("作例から上げた行がある（2026-10-11 に流した）", () => {
        expect(promoted.length).toBeGreaterThan(0);
    });

    it("🔴 上げた行はどれも、作例の確定ファイルに在る「写真を見て確かめた」1枚と同じ（作者・ライセンスも一致）", () => {
        for (const [slug, img] of promoted) {
            const spot = bySlug.get(slug);
            expect(spot, slug).toBeDefined();
            const rec = samples[spot!.spotId]?.samples.find((r) => r.pageUrl === img.pageUrl);
            expect(rec, `${slug}: 作例に無い`).toBeDefined();
            expect(isReviewedPick(rec!), slug).toBe(true);
            const s = toSpotSample(rec!);
            expect(s, slug).toBeDefined();
            expect({ author: img.author, license: img.license, pickedBy: img.pickedBy }, slug)
                .toEqual({ author: s!.author, license: s!.license, pickedBy: rec!.pickedBy.trim() });
        }
    });

    it("上げた行はサイトに置いた縮小版を持ち、ファイルが在る", () => {
        for (const [slug, img] of promoted) {
            expect(img.local?.src, slug).toBe(`/images/spots/${slug}.jpg`);
            expect(fs.existsSync(path.join(__dirname, "../../../public", img.local!.src)), slug).toBe(true);
        }
    });

    it("公開済みで上げた行は、ページの代表写真として出る", () => {
        const shown = promoted.filter(([slug]) => {
            const spot = bySlug.get(slug)!;
            return isPublished(spot) && spotCoverImage(spot);
        });
        expect(shown.length).toBe(promoted.filter(([slug]) => isPublished(bySlug.get(slug)!)).length);
    });
});
