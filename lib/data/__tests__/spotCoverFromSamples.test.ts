import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import rawLedger from "../../../content/spots.json";
import rawImages from "../../../content/spot-images.json";
import rawSamples from "../../../content/spot-samples.json";
import type { Spot } from "../spots";
import {
    shownSpotImage, spotCoverImage, licenseKindOf, isReviewedPick, SAMPLE_COVER_METHOD, spotImageCredit, cleanAuthor, isNoFopCoverExcluded, NO_FOP_COVER_EXCLUSIONS, SPOT_SAMPLE_EXCLUSIONS, isExcludedSample, type SpotImage,
} from "../spotImages";
import {
    coverCandidateSample, sampleCoverEntry, toSpotSample, coverImageObject, PUBLIC_DOMAIN_MARK_URL, isPromotionTarget, spotSamples,
    type SpotSampleRecord, type SpotSamplesFile,
} from "../spotSamples";
import { isPublished } from "../../utils/spotGuide";
import { putImageRecord } from "../../../scripts/fetch-spot-images.mjs";
import { isUnusablePublicDomain, isFlickrPdMark, isUsOnlyPublicDomain, pdBasisOf, hasPlaceholderPhrase } from "../../utils/commonsAttribution.mjs";
import { toSpotBody } from "../spotBody";
import { buildSpotFeed, legacySpotFeed } from "../spotFeed";
import { spotImageEntries } from "../../../app/sitemap-images.xml/route";
import { generateMetadata } from "../../../app/spots/[slug]/page";

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
            name: "Wide",
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
    // パノラマの自由が無い国の現代建築（`NO_FOP_COVER_EXCLUSIONS`）は縮小版を消して出さない（2026-10-11）
    // 作例として表示から落とした1枚を上げた行（ルンビニ）も同じく出さない
    // CC BY 系で作者の欄が名前でない行（英語の「No machine-readable author provided. X assumed …」を #272 どおり
    // 名前にしないと決めた・2026-10-14）も、作例と同じく出さない（下の「作者の欄が名前でない上げた行」で見張る）
    const missingCredit = (v: SpotImage) => {
        const kind = licenseKindOf(v.license);
        return (kind === "cc-by" || kind === "cc-by-sa") && hasPlaceholderPhrase(cleanAuthor(v.author));
    };
    const promoted = Object.entries(images).filter(([slug, v]) => v.method === SAMPLE_COVER_METHOD && !isNoFopCoverExcluded(slug)
        && !isExcludedSample(bySlug.get(slug)!.spotId, v) && !missingCredit(v));

    it("🔴 作者の欄が名前でない上げた行（CC BY 系）は、代表写真にも作例にも出さない（2026-10-14）", () => {
        const hidden = Object.entries(images)
            .filter(([slug, v]) => v.method === SAMPLE_COVER_METHOD && !isNoFopCoverExcluded(slug) && missingCredit(v))
            .map(([slug]) => slug).sort();
        expect(hidden).toEqual(["mijas", "mount-papandayan", "wolchulsan"]);
        for (const slug of hidden) {
            const spot = bySlug.get(slug)!;
            expect(spotCoverImage(spot), slug).toBeUndefined();
            expect(spotSamples(spot).some((s) => s.sourceUrl === images[slug].pageUrl), slug).toBe(false);
        }
    });

    it("🔴 パノラマの自由が無い国の現代建築: 代表写真に出さず、作例からも上げ直さず、縮小版も置かない", () => {
        const slugs = Object.keys(NO_FOP_COVER_EXCLUSIONS);
        expect(slugs).toContain("burj-khalifa");
        expect(slugs).toContain("n-seoul-tower");
        expect(slugs).toContain("lotte-world-tower");
        for (const slug of slugs) {
            const spot = bySlug.get(slug);
            expect(spot, `${slug}: 台帳に無い`).toBeDefined();
            expect(images[slug], `${slug}: 代表写真の行が無い（外す必要が無い）`).toBeDefined();
            expect(spotCoverImage(spot!), slug).toBeUndefined();
            expect(shownSpotImage(spot!), slug).toBeUndefined();
            expect(coverCandidateSample(spot!), slug).toBeUndefined();
            expect(images[slug].local, slug).toBeUndefined();
            expect(fs.existsSync(path.join(__dirname, "../../../public/images/spots", `${slug}.jpg`)), slug).toBe(false);
            expect(fs.existsSync(path.join(__dirname, "../../../public/images/spots/thumb", `${slug}.jpg`)), slug).toBe(false);
        }
        // 人が確かめた印があっても出さない
        const spot = bySlug.get("burj-khalifa")!;
        expect(shownSpotImage(spot, { "burj-khalifa": { ...images["burj-khalifa"], reviewedBy: "someone", local: { src: "/x.jpg", width: 2, height: 1 } } })).toBeUndefined();
    });

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
            // 作者は**表示の形**で比べる（行には上げた時点の整え方の結果が残る。整え方の規則を足しても
            // 表示は作例と同じ1本の規則を通る・2026-10-11）
            expect({ author: spotImageCredit(img), license: img.license, pickedBy: img.pickedBy }, slug)
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

describe("レビューの直し（2026-10-11）", () => {
    const images = rawImages as unknown as Record<string, SpotImage>;
    const bySlug = new Map(ledger.map((s) => [s.slug, s]));
    const promoted = Object.entries(images)
        .filter(([slug, v]) => v.method === SAMPLE_COVER_METHOD && isPublished(bySlug.get(slug)!) && !isNoFopCoverExcluded(slug)
            && !isExcludedSample(bySlug.get(slug)!.spotId, v))
        .map(([slug, v]) => ({ spot: bySlug.get(slug)!, image: v }));

    it("代表写真は題（ファイル名から）を持ち、構造化データの name も題", () => {
        const cover = spotCoverImage(promoted[0].spot)!;
        expect(cover.title).toBe(promoted[0].image.file.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " "));
        expect(coverImageObject(cover, "u").name).toBe(cover.title);
        // Wikidata の代表写真も同じ形
        const p18 = ledger.find((s) => isPublished(s) && images[s.slug]?.method === "wikidata-P18" && spotCoverImage(s))!;
        expect(spotCoverImage(p18)!.title).toBeTruthy();
    });

    it("アプリ向けの索引の写真は題を持つ。古い spots.json には載せない", () => {
        const items = buildSpotFeed(ledger);
        const withImage = items.filter((i) => i.image);
        expect(withImage.every((i) => i.image!.title)).toBe(true);
        expect(legacySpotFeed(items).some((i) => i.image?.title)).toBe(false);
    });

    it("🔴 アプリ向けの本文の作例に、代表写真と同じ1枚を二重に入れない", () => {
        for (const { spot, image } of promoted.slice(0, 200)) {
            const body = toSpotBody(spot);
            expect(body?.samples?.some((x) => x.sourceUrl === image.pageUrl), spot.slug).toBeFalsy();
        }
    });

    it("🔴 画像サイトマップの撮影地ページに、代表写真の元の作例（Commons の URL）を二重に載せない", () => {
        const entries = new Map(spotImageEntries().map((e) => [e.loc, e]));
        let checked = 0;
        for (const { spot, image } of promoted) {
            const e = entries.get(`https://journey-photo.com/spots/${spot.slug}`);
            if (!e) continue;
            // 2026-10-22: 代表写真は横 1,200px 以上の版（Commons の 1280px＝元の作例と同じ URL のことがある）で載せる。
            // 同じ写真が代表写真（サイトの 960px か Commons の版）と作例で2回載らないこと
            const same = e.images.filter((i) => i.src === image.thumbUrl || i.src === image.large?.src || i.src.endsWith(image.local!.src));
            expect(same.length, spot.slug).toBeLessThanOrEqual(1);
            expect(new Set(e.images.map((i) => i.src)).size, spot.slug).toBe(e.images.length);
            checked++;
        }
        expect(checked).toBeGreaterThan(100);
    });

    it("🔴 title・description の「作例N枚」は作例の節に並ぶ枚数（代表写真と同じ作例を除き、代表写真は足さない）", async () => {
        // 作例が6枚未満のスポット（除かないと1枚多く数える）
        const hit = promoted.find(({ spot }) => spotSamples(spot).length < 6 && spotSamples(spot).length > 0)!;
        expect(hit).toBeDefined();
        // 節に並ぶのは `SpotGuidePage` が渡す `spotSamples(spot, { exclude: [cover.sourceUrl] })`
        const n = spotSamples(hit.spot, { exclude: [hit.image.pageUrl] }).length;
        const meta = await generateMetadata({ params: Promise.resolve({ slug: hit.spot.slug }) });
        if (n > 0) {
            expect(String(meta.description)).toContain(`作例${n}枚、`);
            expect(String((meta.title as { absolute?: string })?.absolute ?? "")).toMatch(new RegExp(`作例${n}枚|の写真・撮影スポット`));
        }
        expect(String(meta.description)).not.toContain(`作例${n + 1}枚`);
        const fs = await import("node:fs");
        const path = await import("node:path");
        const page = fs.readFileSync(path.join(__dirname, "../../../app/components/SpotGuidePage.tsx"), "utf8");
        expect(page).toContain("const samples = spotSamples(spot, { exclude: [cover?.sourceUrl] });");
        const route = fs.readFileSync(path.join(__dirname, "../../../app/spots/[slug]/page.tsx"), "utf8");
        expect(route).toContain("const samples = spotSamples(spot, { exclude: [cover?.sourceUrl] });");
        expect(route).toContain("samples: samples.length,");
    });

    it("使えないパブリックドメイン: PD-Detroit・Flickr の Public Domain Mark を落とす", () => {
        expect(isUsOnlyPublicDomain("Public domain", "PD-Detroit")).toBe(true);
        expect(isFlickrPdMark("Public domain", "PD-author-FlickrPDM")).toBe(true);
        expect(isUnusablePublicDomain("Public domain (PD-author-FlickrPDM)", undefined)).toBe(true);
        expect(isUnusablePublicDomain("Public domain", "PD-self")).toBe(false);
        expect(isUnusablePublicDomain("Public domain", "PD-author")).toBe(false);
        expect(toSpotSample({ ...REC, license: "Public domain", licenseUrl: undefined, licenseCode: "PD-author-FlickrPDM" })).toBeUndefined();
        expect(toSpotSample({ ...REC, license: "Public domain", licenseUrl: undefined, licenseCode: "PD-Detroit" })).toBeUndefined();
        // 根拠を選ぶとき、ほかの根拠があればそちらを先に
        expect(pdBasisOf(["Template:PD-author-FlickrPDM", "Template:PD-old"])).toBe("PD-old");
        // 作例から上げた代表写真でも出さない
        const e = { ...sampleCoverEntry(coverCandidateSample(base, file(REC))!, "2026-10-11"), license: "Public domain (PD-author-FlickrPDM)", local: { src: "/x.jpg", width: 960, height: 640 } };
        expect(shownSpotImage(base, { [base.slug]: e })).toBeUndefined();
        // 確定ファイルの代表写真にも残っていない
        expect(Object.values(images).some((v) => v.method === SAMPLE_COVER_METHOD && isUnusablePublicDomain(v.license, v.licenseCode))).toBe(false);
    });

    it("🔴 人が確かめた Wikidata の代表画像（reviewedBy）を持つ行は、作例から上げない", () => {
        const img = (over: Partial<SpotImage>) => ({ [base.slug]: { wikidata: "Q1", file: "File:P.jpg", pageUrl: "p", thumbUrl: "t", author: "a", license: "CC0", method: "wikidata-P18", fetchedAt: "2026-09-26", reviewedBy: null, ...over } as SpotImage });
        const noCover = () => false;
        expect(isPromotionTarget(base, img({}), noCover)).toBe(true);
        expect(isPromotionTarget(base, img({ reviewedBy: "rymaruta" }), noCover)).toBe(false);
        expect(isPromotionTarget(base, {}, noCover)).toBe(true);
        expect(isPromotionTarget(base, {}, () => true)).toBe(false);
        expect(isPromotionTarget({ ...base, status: "review" }, {}, noCover)).toBe(false);
    });

    it("上げる道具は isPromotionTarget を通す", async () => {
        const src = fs.readFileSync(path.join(__dirname, "../../../scripts/promote-sample-covers.ts"), "utf8");
        expect(src).toMatch(/isPromotionTarget\(s, images,/);
    });
});

describe("🔴 パノラマの自由が無い国の現代建築の作例を表示から落とす（2026-10-11）", () => {
    const samplesFile = rawSamples as unknown as SpotSamplesFile;
    const images = rawImages as unknown as Record<string, SpotImage>;
    const byId = new Map(ledger.map((s) => [s.spotId, s]));
    const key = (f: string | undefined) => String(f ?? "").replace(/_/g, " ").replace(/^File:/i, "").trim();

    it("一覧の1枚はどれも確定ファイルに在る（書き間違いで黙って効かない行を作らない）・理由が書いてある", () => {
        expect(SPOT_SAMPLE_EXCLUSIONS.length).toBeGreaterThan(100);
        for (const e of SPOT_SAMPLE_EXCLUSIONS) {
            expect(byId.get(e.spotId), e.spotId).toBeDefined();
            expect(samplesFile[e.spotId]?.samples.some((r) => key(r.file) === key(e.file)), `${e.spotId} ${e.file}`).toBe(true);
            expect(e.reason.trim(), e.file).not.toBe("");
        }
    });

    it("落とした1枚は、作例にも代表写真にも代表写真の候補にも出ない", () => {
        for (const e of SPOT_SAMPLE_EXCLUSIONS) {
            const spot = byId.get(e.spotId)!;
            expect(spotSamples(spot).some((x) => key(decodeURIComponent(x.sourceUrl.replace(/^.*\/wiki\//, ""))) === key(e.file)), `${spot.slug} ${e.file}`).toBe(false);
            expect(key(coverCandidateSample(spot)?.record.file) === key(e.file), spot.slug).toBe(false);
            const cover = shownSpotImage(spot);
            expect(cover && key(cover.file) === key(e.file), spot.slug).toBeFalsy();
        }
        // 作例から上げた代表写真の元の1枚を落としたら、代表写真も出さない（ルンビニ）
        const lumbini = ledger.find((s) => s.slug === "lumbini")!;
        expect(isExcludedSample(lumbini.spotId, images.lumbini)).toBe(true);
        expect(spotCoverImage(lumbini)).toBeUndefined();
    });

    it("作例が1枚も残らない撮影地（ブルジュ・ハリファ）も、ページの説明が壊れない（枚数を言わない）", async () => {
        const spot = ledger.find((s) => s.slug === "burj-khalifa")!;
        expect(spotSamples(spot)).toEqual([]);
        expect(spotCoverImage(spot)).toBeUndefined();
        const meta = await generateMetadata({ params: Promise.resolve({ slug: spot.slug }) });
        expect(String(meta.description)).not.toMatch(/作例|代表写真\d|0枚/);
        expect(String(meta.description).length).toBeGreaterThan(10);
    });
});
