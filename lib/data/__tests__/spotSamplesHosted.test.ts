import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import rawLedger from "../../../content/spots.json";
import type { Spot } from "../spots";
import {
    toSpotSample, spotSamples, sampleImageObject, sampleSourceName, SPOT_SAMPLES, HOSTED_SOURCES, HOSTED_IMAGE_PATH,
    HOSTED_MAX_WIDTH, RESIZED_NOTE, isHostedSourceName, SAMPLE_IMAGE_ORIGINS,
    type SpotSampleRecord, type SpotSamplesFile,
} from "../spotSamples";
import { toSpotBody } from "../spotBody";
import { siteConfig } from "@/lib/utils/seo";

/**
 * **作例の出どころ: サイトに置いた写真**（2026-10-04）。
 *
 * 環境省の国立公園の写真（公共データ利用規約 PDL1.0）と、県の観光協会・観光連盟の写真素材
 * （申請不要のもの）。どれも画像への直リンクを禁じているので、縮小して位置情報を消した JPEG を
 * `public/samples/<slug>/<n>.jpg` に置き、サイトの URL で出す。出典の文・ライセンス欄・規約の
 * ページは提供元ごとの決まり（`HOSTED_SOURCES`）から出し、行の値は使わない。
 */

const ROOT = path.join(__dirname, "..", "..", "..");
const SITE = new URL(siteConfig.url).origin;

const ENV_REC: SpotSampleRecord = {
    title: "タデ原",
    source: { name: "環境省", url: "https://www.env.go.jp/nature/nationalparks/list/aso-kuju/spot/" },
    thumbUrl: "/samples/tadewara/1.jpg",
    width: 890, height: 500,
    author: "環境省", license: "PDL1.0",
    pickedBy: "visual-review",
};

const PREF_REC: SpotSampleRecord = {
    title: "芥屋大門",
    source: { name: "福岡県観光連盟", url: "https://www.crossroadfukuoka.jp/business/photo/424" },
    thumbUrl: "/samples/keya-no-oto/1.jpg",
    width: 1280, height: 826,
    author: "（行の値は使わない）", license: "（行の値は使わない）",
    resized: true,
    pickedBy: "visual-review",
};

describe("サイトに置いた作例を表示の形へ", () => {
    it("環境省: 出典は PDL1.0 の記載例どおり・ライセンスは PDL1.0 の文面・規約は国立公園のサイト利用規約", () => {
        expect(toSpotSample(ENV_REC)).toEqual({
            src: `${SITE}/samples/tadewara/1.jpg`,
            width: 890, height: 500,
            title: "タデ原",
            author: "環境省",
            license: "PDL1.0",
            licenseUrl: "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0",
            sourceUrl: ENV_REC.source!.url,
            source: { name: "環境省", url: ENV_REC.source!.url },
            credit: "出典：「タデ原の写真」（環境省）",
            termsUrl: "https://www.env.go.jp/nature/nationalparks/terms/",
        });
    });

    it("環境省の写真を縮小したら、出典の文に「加工して作成」とその主体が入る（PDL1.0 の決まり）", () => {
        const s = toSpotSample({ ...ENV_REC, resized: true })!;
        expect(s.credit).toBe("出典：「タデ原の写真」（環境省）を加工して作成（journey.photo が縮小）");
        expect(s).not.toHaveProperty("modified");
    });

    it("県の観光連盟: 作者・ライセンス・出典の文は決まりから（行の値は使わない）・縮小したら加工の表記", () => {
        const s = toSpotSample(PREF_REC)!;
        expect(s).toMatchObject({
            src: `${SITE}/samples/keya-no-oto/1.jpg`,
            author: "福岡県観光連盟",
            license: "クロスロードふくおか フォトダウンロード利用規約",
            licenseUrl: "https://www.crossroadfukuoka.jp/business/photo/guide",
            credit: "写真提供：福岡県観光連盟",
            modified: RESIZED_NOTE,
            termsUrl: "https://www.crossroadfukuoka.jp/business/photo/guide",
            source: { name: "福岡県観光連盟", url: PREF_REC.source!.url },
        });
    });

    it("規約が写真のページに載っている提供元は、ライセンスと規約のリンクが写真のページ", () => {
        const url = "https://yamaguchi-tourism.jp/photo/detail_180030.html";
        const s = toSpotSample({ ...PREF_REC, source: { name: "山口県観光連盟", url } })!;
        expect(s.licenseUrl).toBe(url);
        expect(s.termsUrl).toBe(url);
        expect(s.credit).toBe("写真提供：山口県観光連盟");
    });

    it("出してはいけない1枚は落とす（外部の画像・幅が 1280px 超え・別のホストの出典・題なし・知らない名前・人物の印）", () => {
        expect(toSpotSample({ ...ENV_REC, thumbUrl: "https://www.env.go.jp/nature/nationalparks/list/aso-kuju/images/spot/spot_modal_026.jpg" })).toBeUndefined();
        expect(toSpotSample({ ...ENV_REC, thumbUrl: "/images/spots/tadewara.jpg" })).toBeUndefined();
        expect(toSpotSample({ ...ENV_REC, thumbUrl: "/samples/../x/1.jpg" })).toBeUndefined();
        expect(toSpotSample({ ...ENV_REC, width: 1281 })).toBeUndefined();
        expect(toSpotSample({ ...ENV_REC, width: 0 })).toBeUndefined();
        expect(toSpotSample({ ...ENV_REC, source: { name: "環境省", url: "https://example.com/spot/" } })).toBeUndefined();
        expect(toSpotSample({ ...ENV_REC, source: { name: "環境省", url: "http://www.env.go.jp/nature/" } })).toBeUndefined();
        expect(toSpotSample({ ...ENV_REC, title: " " })).toBeUndefined();
        expect(toSpotSample({ ...ENV_REC, personality: true })).toBeUndefined();
        expect(toSpotSample({ ...ENV_REC, source: { name: "岡山県観光連盟" as never, url: ENV_REC.source!.url } })).toBeUndefined();
        expect(sampleSourceName({ source: { name: "宮城県観光連盟" as never, url: "https://x" } })).toBeUndefined();
    });

    it("構造化データ: license は規約の文面・acquireLicensePage は規約のページ・作者は団体・表示の文字は出典の文", () => {
        expect(sampleImageObject(toSpotSample(ENV_REC)!)).toEqual({
            "@type": "ImageObject",
            name: "タデ原",
            contentUrl: `${SITE}/samples/tadewara/1.jpg`,
            width: 890, height: 500,
            creator: { "@type": "Organization", name: "環境省" },
            creditText: "出典：「タデ原の写真」（環境省）",
            license: "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0",
            acquireLicensePage: "https://www.env.go.jp/nature/nationalparks/terms/",
        });
        expect(sampleImageObject(toSpotSample(PREF_REC)!).creditText).toBe(`写真提供：福岡県観光連盟（${RESIZED_NOTE}）`);
    });

    it("アプリ向けの本文にも同じ形で入る（source・credit・サイトの画像 URL）", () => {
        const spot = (rawLedger as unknown as Spot[]).find((s) => s.slug === "tadewara")!;
        const file: SpotSamplesFile = { [spot.spotId]: { slug: spot.slug, name: spot.name, samples: [ENV_REC] } };
        expect(toSpotBody(spot, file)!.samples?.[0]).toMatchObject({
            src: `${SITE}/samples/tadewara/1.jpg`,
            source: { name: "環境省", url: ENV_REC.source!.url },
            credit: "出典：「タデ原の写真」（環境省）",
            license: "PDL1.0",
        });
    });
});

describe("確定ファイルのサイトに置いた作例", () => {
    const hosted = Object.values(SPOT_SAMPLES).flatMap((e) =>
        e.samples.filter((r) => isHostedSourceName(r.source?.name)).map((r) => ({ entry: e, r })));

    it("ある（このテストが空振りしない）", () => {
        expect(hosted.length).toBeGreaterThan(0);
    });

    it("🔴 全部が表示の形になる・画像はその撮影地のフォルダ・ファイルが public/ にある", () => {
        for (const { entry, r } of hosted) {
            const s = toSpotSample(r);
            expect(s, r.thumbUrl).toBeTruthy();
            expect(r.thumbUrl).toMatch(HOSTED_IMAGE_PATH);
            expect(r.thumbUrl.split("/")[2], r.thumbUrl).toBe(entry.slug);
            expect(fs.existsSync(path.join(ROOT, "public", r.thumbUrl)), r.thumbUrl).toBe(true);
            expect(SAMPLE_IMAGE_ORIGINS).toContain(new URL(s!.src).origin);
            expect(s!.src.startsWith(`${SITE}/samples/`)).toBe(true);
        }
    });

    it("🔴 置いた画像は JPEG・幅 1280px 以下・寸法が行と同じ・EXIF（位置情報）も XMP も無い", async () => {
        for (const { r } of hosted) {
            const file = path.join(ROOT, "public", r.thumbUrl);
            const meta = await sharp(file).metadata();
            expect(meta.format, r.thumbUrl).toBe("jpeg");
            expect(meta.width, r.thumbUrl).toBe(r.width);
            expect(meta.height, r.thumbUrl).toBe(r.height);
            expect(meta.width!).toBeLessThanOrEqual(HOSTED_MAX_WIDTH);
            expect(meta.exif, r.thumbUrl).toBeUndefined();
            expect(meta.xmp, r.thumbUrl).toBeUndefined();
            expect(fs.readFileSync(file).includes("GPS"), r.thumbUrl).toBe(false);
        }
    });

    it("public/samples/ に置いたファイルは全部どこかの行が使っている（置きっぱなしを作らない）", () => {
        const used = new Set(hosted.map(({ r }) => r.thumbUrl));
        const dir = path.join(ROOT, "public", "samples");
        const files = fs.readdirSync(dir).flatMap((slug) => fs.readdirSync(path.join(dir, slug)).map((f) => `/samples/${slug}/${f}`));
        expect(files.sort()).toEqual([...used].sort());
    });

    it("同じ撮影地で出る枚数は6枚まで（足した分で溢れていない）", () => {
        const ledger = rawLedger as unknown as Spot[];
        for (const { entry } of hosted) {
            const spot = ledger.find((s) => s.slug === entry.slug)!;
            const shown = spotSamples(spot);
            const hostedShown = shown.filter((s) => isHostedSourceName(s.source?.name));
            expect(hostedShown.length, entry.slug).toBe(entry.samples.filter((r) => isHostedSourceName(r.source?.name)).length);
        }
    });

    it("提供元の決まりは、申請不要と確かめたものだけ（岡山・宮城・東北観光推進機構などは入れない）", () => {
        expect(Object.keys(HOSTED_SOURCES).sort()).toEqual(
            ["やまなし観光推進機構", "宮崎県観光協会", "山口県観光連盟", "熊本県観光連盟", "環境省", "福岡県観光連盟", "香川県観光協会"].sort());
    });
});
