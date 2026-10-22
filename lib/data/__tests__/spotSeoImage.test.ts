import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Spot } from "../spots";
import { SPOTS } from "../spots";
import { SPOT_IMAGES, SEO_IMAGE_MIN_WIDTH, spotCoverLarge, type SpotImage } from "../spotImages";
import { spotSamples, spotSeoImage, spotCoverSeoSource, type SpotSample } from "../spotSamples";
import { spotStructuredData } from "../spotSeo";
import { publishableSpots } from "../../utils/spotGuide";
import { siteConfig } from "../../utils/seo";
import { generateMetadata } from "../../../app/spots/[slug]/page";
import { spotImageEntries } from "../../../app/sitemap-images.xml/route";
import { firstSpotOgImage } from "../spotTopics";
import SpotGuidePage from "../../../app/components/SpotGuidePage";
import { usableLarge, knownSizes, normalizeLarge } from "../../../scripts/spot-cover-large.mjs";

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
        // Commons 以外
        expect(spotCoverLarge(s, { [s.slug]: image({ large: { src: "https://example.com/Foo_bar.jpg", width: 1280, height: 853 } }) })).toBeUndefined();
        // 画面に代表写真を出さない（サイトに置いていない・下書き）なら渡さない
        expect(spotCoverLarge(s, { [s.slug]: image({ local: undefined }) })).toBeUndefined();
        expect(spotCoverLarge(spot({ status: "review", verifiedBy: undefined }), { [s.slug]: image() })).toBeUndefined();
    });
});

describe("検索・共有に渡す1枚（spotSeoImage）の選ぶ順", () => {
    const s = spot();
    it("1. 代表写真の 1,200 以上の版（寸法つき）", () => {
        expect(spotSeoImage(s, [sample()], { [s.slug]: image() })).toEqual({ url: COMMONS_1280, width: 1280, height: 853, from: "cover" });
    });
    it("2. 代表写真が 1,200 に届かなければ、1,200 以上の作例（小さい作例は飛ばす）", () => {
        const small = sample({ src: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/S.jpg/960px-S.jpg", width: 960, height: 640 });
        const big = sample();
        const got = spotSeoImage(s, [small, big], { [s.slug]: image({ large: undefined }) });
        expect(got).toMatchObject({ url: big.src, width: 1280, height: 720, from: "sample" });
        expect(got?.sample).toBe(big);
        // 代表写真が無くても、1,200 以上の作例があればそれ
        expect(spotSeoImage(s, [big], {})).toMatchObject({ url: big.src, from: "sample" });
    });
    it("3. どちらも無ければ代表写真の 960px（寸法つき）。何も無ければ undefined", () => {
        const small = sample({ width: 960, height: 640 });
        expect(spotSeoImage(s, [small], { [s.slug]: image({ large: undefined }) })).toEqual({
            url: `${siteConfig.url}/images/spots/test-spot.jpg`, width: 960, height: 640, from: "cover",
        });
        expect(spotSeoImage(s, [small], {})).toBeUndefined();
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

    it("🔴 代表写真が 1,200 に届かない公開ページは、1,200 以上の作例があればそれを og:image にする", async () => {
        const hit = withCover.find((p) => !spotCoverSeoSource(p)!.large
            && spotSamples(p, { exclude: [SPOT_IMAGES[p.slug]?.pageUrl] }).some((s) => s.width >= 1200));
        expect(hit, "該当するページが無い（データが変わった）").toBeDefined();
        const m = await generateMetadata({ params: Promise.resolve({ slug: hit!.slug }) });
        const og = (m.openGraph as { images: Array<{ url: string; width?: number }> }).images[0];
        expect(og.width).toBeGreaterThanOrEqual(1200);
        expect(og.url).not.toContain("/images/spots/");
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

    it("作例の確定ファイルの寸法を候補より優先する", () => {
        const m = knownSizes(
            { a: { samples: [{ file: "File:Foo_bar.jpg", thumbUrl: COMMONS_1280, width: 1280, height: 853 }] } },
            { spots: { a: { candidates: [{ file: "File:Foo bar.jpg", thumbUrl: COMMONS_1280, width: 1, height: 1 }] } } },
        );
        expect(m.get("Foo bar.jpg")).toEqual({ src: COMMONS_1280, width: 1280, height: 853 });
    });
});
