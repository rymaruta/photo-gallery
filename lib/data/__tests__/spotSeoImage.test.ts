import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Spot } from "../spots";
import { SPOTS } from "../spots";
import { SPOT_IMAGES, SEO_IMAGE_MIN_WIDTH, spotCoverLarge, type SpotImage } from "../spotImages";
import {
    spotSamples, spotSeoImage, spotCoverSeoSource, reviewedSampleSources, SPOT_SAMPLES,
    type SpotSample, type SpotSampleRecord, type SpotSamplesFile,
} from "../spotSamples";
import { spotStructuredData } from "../spotSeo";
import { publishableSpots } from "../../utils/spotGuide";
import { siteConfig } from "../../utils/seo";
import { generateMetadata } from "../../../app/spots/[slug]/page";
import { spotImageEntries } from "../../../app/sitemap-images.xml/route";
import { firstSpotOgImage, seasonView, topicMetadata, areaStructuredData } from "../spotTopics";
import { spotAreas, visibleSpotsInArea } from "../spotLink";
import SpotGuidePage from "../../../app/components/SpotGuidePage";
import { usableLarge, knownSizes, normalizeLarge, applyLarge } from "../../../scripts/spot-cover-large.mjs";

/**
 * **スポットのページの代表写真を、横 1,200px 以上で検索に渡す**（2026-10-22・SEO）。
 *
 * サイトに置いた代表写真は横 960px（`localize-spot-images.mjs`）で、og:image・構造化データ・画像サイトマップが
 * それをそのまま（寸法も無しで）渡していた。Google の画像検索・Discover は横 1,200px 以上を大きく出す。
 * Commons に同じ写真の 1280px 版が既にあるので、その URL と寸法を渡す。ページの `<img>` は 960px のまま。
 */

const COMMONS_1280 = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo_bar.jpg/1280px-Foo_bar.jpg";

function spot(over: Partial<Spot> = {}): Spot {
    return {
        spotId: "sp_test00000001",
        slug: "test-spot",
        name: "テストの場所",
        summary: "あ".repeat(40),
        region: { country: "日本", prefecture: "香川県" },
        coords: { lat: 34, lng: 134 },
        highlights: ["見どころ"],
        officialWebsiteUrl: "https://example.example/",
        status: "published",
        verifiedBy: "運営",
        verifiedAt: "2026-09-25",
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
        ...over,
    } as Spot;
}

function image(over: Partial<SpotImage> = {}): SpotImage {
    return {
        wikidata: "Q1",
        file: "File:Foo bar.jpg",
        pageUrl: "https://commons.wikimedia.org/wiki/File:Foo_bar.jpg",
        thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo_bar.jpg/960px-Foo_bar.jpg",
        author: "Taro Yamada",
        license: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0",
        method: "wikidata-P18",
        fetchedAt: "2026-09-26",
        reviewedBy: "運営",
        local: { src: "/images/spots/test-spot.jpg", width: 960, height: 640 },
        large: { src: COMMONS_1280, width: 1280, height: 853 },
        ...over,
    };
}

function sample(over: Partial<SpotSample> = {}): SpotSample {
    return {
        src: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Other.jpg/1280px-Other.jpg",
        width: 1280,
        height: 720,
        title: "Other",
        author: "Hanako",
        license: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Other.jpg",
        ...over,
    };
}

describe("代表写真の 1,200px 以上の版（spotCoverLarge）", () => {
    it("同じファイルの Commons の版で、横 1,200 以上のときだけ返す", () => {
        const s = spot();
        expect(spotCoverLarge(s, { [s.slug]: image() })).toEqual({ src: COMMONS_1280, width: 1280, height: 853 });
        // 小さい
        expect(spotCoverLarge(s, { [s.slug]: image({ large: { src: COMMONS_1280, width: 1199, height: 800 } }) })).toBeUndefined();
        // 別のファイル（別の写真を「大きい代表写真」として渡さない）
        const other = "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Other.jpg/1280px-Other.jpg";
        expect(spotCoverLarge(s, { [s.slug]: image({ large: { src: other, width: 1280, height: 853 } }) })).toBeUndefined();
        // 縮小版でない（元画像の URL）・URL の幅と記録の幅が食い違う
        expect(spotCoverLarge(s, { [s.slug]: image({ large: { src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo_bar.jpg", width: 1280, height: 853 } }) })).toBeUndefined();
        expect(spotCoverLarge(s, { [s.slug]: image({ large: { src: COMMONS_1280, width: 4000, height: 2667 } }) })).toBeUndefined();
        // URL に空白・引用符などが混ざる（属性やメタの値を壊しうる）ものは使わない
        expect(spotCoverLarge(s, { [s.slug]: image({ large: { src: `${COMMONS_1280.replace(/\/1280px-Foo_bar\.jpg$/, "")}/1280px-Foo bar".jpg`, width: 1280, height: 853 } }) })).toBeUndefined();
        // Commons 以外
        expect(spotCoverLarge(s, { [s.slug]: image({ large: { src: "https://example.com/Foo_bar.jpg", width: 1280, height: 853 } }) })).toBeUndefined();
        // 画面に代表写真を出さない（サイトに置いていない・下書き）なら渡さない
        expect(spotCoverLarge(s, { [s.slug]: image({ local: undefined }) })).toBeUndefined();
        expect(spotCoverLarge(spot({ status: "review", verifiedBy: undefined }), { [s.slug]: image() })).toBeUndefined();
    });
});

/** 確定ファイルの1行（Commons・CC BY 4.0） */
function rec(name: string, px: number, w: number, h: number, pickedBy = "visual-review"): SpotSampleRecord {
    return {
        file: `File:${name}.jpg`,
        pageUrl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
        thumbUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/${name}.jpg/${px}px-${name}.jpg`,
        width: w,
        height: h,
        author: "Hanako",
        license: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0",
        pickedBy,
    } as SpotSampleRecord;
}

describe("検索・共有に渡す1枚（spotSeoImage）の選ぶ順", () => {
    const s = spot();
    const fileOf = (...rows: SpotSampleRecord[]): SpotSamplesFile => ({ [s.spotId]: { slug: s.slug, name: s.name, samples: rows } });
    const pick = (file: SpotSamplesFile, images: Record<string, SpotImage>) => spotSeoImage(s, spotSamples(s, { file }), images, file);

    it("1. 代表写真の 1,200 以上の版（寸法つき）", () => {
        expect(pick(fileOf(rec("Big", 1280, 1280, 720)), { [s.slug]: image() })).toEqual({ url: COMMONS_1280, width: 1280, height: 853, from: "cover" });
    });
    it("2. 代表写真が 1,200 に届かなければ、場所を確かめた 1,200 以上の作例（小さい作例は飛ばす）", () => {
        const file = fileOf(rec("Small", 960, 960, 640), rec("Big", 1280, 1280, 720));
        const got = pick(file, { [s.slug]: image({ large: undefined }) });
        expect(got).toMatchObject({ url: expect.stringContaining("/1280px-Big.jpg"), width: 1280, height: 720, from: "sample" });
        expect(got?.sample?.title).toBe("Big");
        // 代表写真が無くても、確かめた 1,200 以上の作例があればそれ
        expect(pick(file, {})).toMatchObject({ from: "sample", width: 1280 });
    });
    it("🔴 2. 名前の一致だけで選んだ作例（pickedBy: auto）は代表にしない（2026-10-22 判断）", () => {
        const file = fileOf(rec("Big", 1280, 1280, 720, "auto"));
        expect(pick(file, { [s.slug]: image({ large: undefined }) })).toMatchObject({ from: "cover", width: 960 });
        expect(pick(file, {})).toBeUndefined();
    });
    it("🔴 作例の幅は URL の幅が正（URL は 960px なのに記録が 1280 の行を 1,200 以上と申告しない）", () => {
        // dubai-frame の1件と同じ形（縦長・記録は元の縦横比のまま幅だけ別）
        const file = fileOf(rec("Tall", 960, 1280, 1706));
        const [one] = spotSamples(s, { file });
        expect(one).toMatchObject({ width: 960, height: 1280 });
        expect(pick(file, {})).toBeUndefined();
    });
    it("3. どちらも無ければ代表写真の 960px（寸法つき）。何も無ければ undefined", () => {
        const file = fileOf(rec("Small", 960, 960, 640));
        expect(pick(file, { [s.slug]: image({ large: undefined }) })).toEqual({
            url: `${siteConfig.url}/images/spots/test-spot.jpg`, width: 960, height: 640, from: "cover",
        });
        expect(pick(file, {})).toBeUndefined();
    });
    it("構造化データ: 作例を選んだときはその1枚が先頭、代表写真が次", () => {
        const big = sample();
        const rest = sample({ src: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/R.jpg/1280px-R.jpg", title: "R" });
        const data = spotStructuredData(s, { image: "https://journey-photo.com/c.jpg", samples: [rest, big], lead: big });
        const list = data.image as Array<string | { contentUrl: string }>;
        expect(list.map((x) => (typeof x === "string" ? x : x.contentUrl))).toEqual([big.src, "https://journey-photo.com/c.jpg", rest.src]);
    });
});

describe("実データ（2026-10-22）", () => {
    const pages = publishableSpots(SPOTS);
    const withCover = pages.filter((p) => spotCoverSeoSource(p));

    it("🔴 代表写真のある公開ページの 70% 以上で、代表写真を横 1,200px 以上で渡す", () => {
        const large = withCover.filter((p) => spotCoverSeoSource(p)!.large);
        expect(withCover.length).toBeGreaterThan(2000);
        expect(large.length / withCover.length).toBeGreaterThan(0.7);
        for (const p of large) {
            const src = spotCoverSeoSource(p)!;
            expect(src.width, p.slug).toBeGreaterThanOrEqual(SEO_IMAGE_MIN_WIDTH);
            expect(src.url, p.slug).toMatch(new RegExp(`/${src.width}px-[^/?]+$`));
            expect(src.height, p.slug).toBeGreaterThan(0);
            // 縦横比はサイトに置いた版と同じ（同じ写真）
            const local = SPOT_IMAGES[p.slug].local!;
            expect(Math.abs(src.width! / src.height! - local.width / local.height), p.slug).toBeLessThan(0.02);
        }
    });

    it("🔴 og:image・twitter:image は横 1,200px 以上で、幅・高さを申告する", async () => {
        const hit = withCover.find((p) => spotCoverSeoSource(p)!.large)!;
        const m = await generateMetadata({ params: Promise.resolve({ slug: hit.slug }) });
        const og = (m.openGraph as { images: Array<{ url: string; width?: number; height?: number }> }).images[0];
        expect(og.url).toBe(SPOT_IMAGES[hit.slug].large!.src);
        expect(og.width).toBeGreaterThanOrEqual(1200);
        expect(og.height).toBeGreaterThan(0);
        expect((m.twitter as { images: string[]; card: string }).images).toEqual([og.url]);
        expect((m.twitter as { card: string }).card).toBe("summary_large_image");
    });

    /** 代表写真が 1,200 に届かず、場所を確かめた 1,200 以上の作例を代表にするページ */
    const sampleLed = () => pages.find((p) => {
        const cover = spotCoverSeoSource(p);
        return Boolean(cover && !cover.large)
            && spotSeoImage(p, spotSamples(p, { exclude: [SPOT_IMAGES[p.slug]?.pageUrl] }))?.from === "sample";
    });

    it("🔴 代表写真が 1,200 に届かない公開ページは、場所を確かめた 1,200 以上の作例があればそれを og:image にする", async () => {
        const hit = sampleLed();
        expect(hit, "該当するページが無い（データが変わった）").toBeDefined();
        const m = await generateMetadata({ params: Promise.resolve({ slug: hit!.slug }) });
        const og = (m.openGraph as { images: Array<{ url: string; width?: number }> }).images[0];
        expect(og.width).toBeGreaterThanOrEqual(1200);
        expect(og.url).not.toContain("/images/spots/");
        // 選んだ作例は場所を確かめた1枚
        const reviewed = reviewedSampleSources(hit!, SPOT_SAMPLES);
        const picked = spotSeoImage(hit!, spotSamples(hit!, { exclude: [SPOT_IMAGES[hit!.slug]?.pageUrl] }))!;
        expect(reviewed.has(picked.sample!.sourceUrl)).toBe(true);
    });

    it("🔴 確かめた 1,200 以上の写真が無いページは、代表写真の 960px（寸法つき）のまま", async () => {
        const hit = pages.find((p) => {
            const cover = spotCoverSeoSource(p);
            return Boolean(cover && !cover.large)
                && spotSeoImage(p, spotSamples(p, { exclude: [SPOT_IMAGES[p.slug]?.pageUrl] }))?.from === "cover";
        });
        expect(hit, "該当するページが無い（データが変わった）").toBeDefined();
        const m = await generateMetadata({ params: Promise.resolve({ slug: hit!.slug }) });
        const og = (m.openGraph as { images: Array<{ url: string; width?: number; height?: number }> }).images[0];
        expect(og.url).toBe(`${siteConfig.url}/images/spots/${hit!.slug}.jpg`);
        expect(og.width).toBe(SPOT_IMAGES[hit!.slug].local!.width);
        expect(og.height).toBe(SPOT_IMAGES[hit!.slug].local!.height);
    });

    it("🔴 og:image・JSON-LD の先頭・画像サイトマップの先頭は同じ1枚（代表写真の版／作例を選んだページの両方）", async () => {
        const coverLed = withCover.find((p) => spotCoverSeoSource(p)!.large)!;
        for (const p of [coverLed, sampleLed()!]) {
            const m = await generateMetadata({ params: Promise.resolve({ slug: p.slug }) });
            const og = (m.openGraph as { images: Array<{ url: string; width?: number; height?: number }> }).images[0];
            const el = await SpotGuidePage({ slug: p.slug });
            type El = { type?: unknown; props?: { dangerouslySetInnerHTML?: { __html: string }; children?: unknown } };
            const scripts = ((el as El).props?.children as El[]).filter((c) => c && c.type === "script");
            const place = scripts.map((c) => JSON.parse(c.props!.dangerouslySetInnerHTML!.__html)).find((d) => d["@type"] === "TouristAttraction");
            const first = (Array.isArray(place.image) ? place.image[0] : place.image) as { contentUrl: string; width: number; height: number };
            const site = spotImageEntries([p])[0];
            expect(first.contentUrl, p.slug).toBe(og.url);
            expect(site.images[0].src, p.slug).toBe(og.url);
            expect([first.width, first.height], p.slug).toEqual([og.width, og.height]);
        }
    });

    it("🔴 画像サイトマップ: 作例を選んだページは、その作例が先頭・代表写真が次・残りの作例はそのあと（重複なし）", () => {
        const p = sampleLed()!;
        const cover = spotCoverSeoSource(p)!;
        const samples = spotSamples(p, { exclude: [SPOT_IMAGES[p.slug]?.pageUrl] });
        const lead = spotSeoImage(p, samples)!.sample!;
        const srcs = spotImageEntries([p])[0].images.map((i) => i.src);
        expect(srcs[0]).toBe(lead.src);
        expect(srcs[1]).toBe(cover.url);
        expect(srcs.slice(2)).toEqual(samples.filter((x) => x !== lead).map((x) => x.src));
        expect(new Set(srcs).size).toBe(srcs.length);
    });

    it("🔴 県・まとめの頁の OGP に幅・高さ（topicMetadata・areaStructuredData）", () => {
        const view = seasonView("autumn", null)!;
        const og = topicMetadata(view).openGraph!.images![0] as { url: string; width?: number; height?: number };
        expect(og.width).toBeGreaterThanOrEqual(1200);
        expect(og.height).toBeGreaterThan(0);
        const area = spotAreas().find((a) => visibleSpotsInArea(a.slug).some((x) => spotCoverSeoSource(x)?.large))!;
        const { ogImage } = areaStructuredData(area, visibleSpotsInArea(area.slug));
        expect(ogImage!.width).toBeGreaterThanOrEqual(1200);
        expect(ogImage!.height).toBeGreaterThan(0);
        expect(ogImage!.url).toMatch(new RegExp(`/${ogImage!.width}px-`));
    });

    it("🔴 ページの構造化データの代表写真（ImageObject）も横 1,200px 以上の版で、幅・高さつき", async () => {
        const hit = withCover.find((p) => spotCoverSeoSource(p)!.large)!;
        const el = await SpotGuidePage({ slug: hit.slug });
        type El = { type?: unknown; props?: { type?: string; dangerouslySetInnerHTML?: { __html: string }; children?: unknown } };
        const scripts = ((el as El).props?.children as El[]).filter((c) => c && c.type === "script");
        const place = scripts.map((c) => JSON.parse(c.props!.dangerouslySetInnerHTML!.__html)).find((d) => d["@type"] === "TouristAttraction");
        const first = (Array.isArray(place.image) ? place.image[0] : place.image) as { contentUrl: string; width: number; height: number };
        expect(first.contentUrl).toBe(SPOT_IMAGES[hit.slug].large!.src);
        expect(first.width).toBeGreaterThanOrEqual(1200);
        expect(first.height).toBeGreaterThan(0);
    });

    it("🔴 画像サイトマップの代表写真も横 1,200px 以上の版", () => {
        const hit = withCover.find((p) => spotCoverSeoSource(p)!.large)!;
        const e = spotImageEntries([hit])[0];
        expect(e.images[0].src).toBe(SPOT_IMAGES[hit.slug].large!.src);
        expect(e.images.some((i) => i.src.endsWith(`/images/spots/${hit.slug}.jpg`))).toBe(false);
    });

    it("🔴 県・まとめの頁の OGP も、1,200px 以上の版を持つ行を先に選ぶ", () => {
        const og = firstSpotOgImage(pages, "x")!;
        expect(og.width).toBeGreaterThanOrEqual(1200);
        expect(og.height).toBeGreaterThan(0);
    });

    it("🔴 ページの <img>（代表写真）はサイトに置いた 960px のまま（外の画像を LCP に載せない）", () => {
        const client = fs.readFileSync(path.join(__dirname, "../../../app/components/SpotGuideClient.tsx"), "utf8");
        expect(client).toMatch(/<img src=\{cover!\.src\}/);
        expect(client).not.toMatch(/large/);
    });
});

describe("記録を作る道具（scripts/spot-cover-large.mjs）", () => {
    it("同じファイルの 1,200 以上だけを使える版とみなす", () => {
        expect(usableLarge("File:Foo bar.jpg", { src: COMMONS_1280, width: 1280, height: 853 })).toBe(true);
        expect(usableLarge("File:Foo bar.jpg", { src: COMMONS_1280, width: 1000, height: 853 })).toBe(false);
        expect(usableLarge("File:Baz.jpg", { src: COMMONS_1280, width: 1280, height: 853 })).toBe(false);
    });
    it("🔴 URL の幅が正。元画像の寸法のままの記録は高さを出し直し、元画像の URL・問い合わせ付きの新しい形は直す", () => {
        // 候補ファイルの一部は縮小版の URL に元画像の寸法を書いていた（実データ 57 件）
        expect(normalizeLarge({ src: COMMONS_1280, width: 3008, height: 2000 })).toEqual({ src: COMMONS_1280, width: 1280, height: 851 });
        // Commons の API は元画像が 1280 より小さくても thumbwidth=1280 を返す。元画像の URL は使わない
        expect(normalizeLarge({ src: "https://upload.wikimedia.org/wikipedia/commons/0/0a/X.jpg?utm_content=thumbnail_unscaled", width: 1280, height: 856 })).toBeUndefined();
        expect(normalizeLarge({
            src: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo_bar.jpg/1280px-Foo_bar.jpg?utm_source=commons.wikimedia.org",
            width: 1280, height: 853,
        })).toEqual({ src: COMMONS_1280, width: 1280, height: 853 });
        expect(usableLarge("File:Foo bar.jpg", { src: COMMONS_1280, width: 3008, height: 2000 })).toBe(false);
    });

    it("🔴 手元の記録が使えない・無いときも、前に書いた使える large は消さない（使えない large は消す）", () => {
        const good = { src: COMMONS_1280, width: 1280, height: 853 };
        const a = { file: "File:Foo bar.jpg", large: { ...good } };
        const b = { file: "File:Foo bar.jpg", large: { ...good } };
        const c = { file: "File:Foo bar.jpg", large: { src: COMMONS_1280, width: 3008, height: 2000 } };
        const known = new Map([["Foo bar.jpg", { src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo_bar.jpg", width: 900, height: 600 }]]);
        expect(applyLarge([a], known)).toMatchObject({ large: 1, changed: 0 });
        expect(a.large).toEqual(good);
        expect(applyLarge([b], new Map())).toMatchObject({ large: 1, changed: 0 });
        expect(b.large).toEqual(good);
        expect(applyLarge([c], known)).toMatchObject({ small: 1, changed: 1 });
        expect(c.large).toBeUndefined();
    });
    it("🔴 使える記録を、後から来た使えない記録で上書きしない", () => {
        const m = knownSizes(
            { a: { samples: [{ file: "File:Foo bar.jpg", thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo_bar.jpg", width: 900, height: 600 }] } },
            { spots: { a: { candidates: [{ file: "File:Foo bar.jpg", thumbUrl: COMMONS_1280, width: 1280, height: 853 }] } } },
        );
        expect(m.get("Foo bar.jpg")).toEqual({ src: COMMONS_1280, width: 1280, height: 853 });
    });

    it("作例の確定ファイルの寸法を候補より優先する", () => {
        const m = knownSizes(
            { a: { samples: [{ file: "File:Foo_bar.jpg", thumbUrl: COMMONS_1280, width: 1280, height: 853 }] } },
            { spots: { a: { candidates: [{ file: "File:Foo bar.jpg", thumbUrl: COMMONS_1280, width: 1, height: 1 }] } } },
        );
        expect(m.get("Foo bar.jpg")).toEqual({ src: COMMONS_1280, width: 1280, height: 853 });
    });
});
