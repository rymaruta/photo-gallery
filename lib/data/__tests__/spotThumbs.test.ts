import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import rawLedger from "../../../content/spots.json";
import type { Spot } from "../spots";
import type { SpotImage } from "../spotImages";
import { buildSpotFeed, spotIndexFeedJson, toSpotFeedItem } from "../spotFeed";
import { spotFeedFileJson, spotFeedFiles } from "../spotFeedShards";
import { spotThumbExists, spotThumbSrc } from "../spotThumbs";
import { dailyQuizFor, quizDates, quizPool } from "../quizFeed";
import { siteConfig } from "../../utils/seo";

/**
 * **写真の小さい版（`image.thumbUrl`）は、ファイルが在るときだけ出す**（2026-10-08）。
 * アプリ（iOS）はこの鍵が在れば 40pt の丸にこちらを使い、無ければ `url` に戻る。
 * 在るのに出さない・無いのに出す（404 の URL を配る）のどちらも見張る。
 */

const ledger = rawLedger as unknown as Spot[];
// AI 照合で写真も照らした公開済みの行（`spotImages.test.ts` と同じ土台）
const base = ledger.find((s) => s.slug === "himeji-castle")!;

const IMAGE: SpotImage = {
    wikidata: "Q1", file: "File:X.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
    thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg",
    author: "Someone", license: "CC BY-SA 4.0",
    method: "wikidata-P18", fetchedAt: "2026-09-26", reviewedBy: null,
    local: { src: "/images/spots/himeji-castle.jpg", width: 960, height: 640 },
};
const images = (image: Partial<SpotImage> = {}) => ({ [base.slug]: { ...IMAGE, ...image } });

describe("サムネの場所", () => {
    it("サイトに置いた写真の隣の thumb/", () => {
        expect(spotThumbSrc("/images/spots/himeji-castle.jpg")).toBe("/images/spots/thumb/himeji-castle.jpg");
    });

    it("形の違う場所には作らない（外の URL・入れ子・別の拡張子）", () => {
        expect(spotThumbSrc("https://upload.wikimedia.org/x.jpg")).toBeUndefined();
        expect(spotThumbSrc("/images/spots/thumb/himeji-castle.jpg")).toBeUndefined();
        expect(spotThumbSrc("/images/spots/../secret.jpg")).toBeUndefined();
        expect(spotThumbSrc("/images/spots/himeji-castle.png")).toBeUndefined();
    });

    it("在るかは public/ のファイルで見る", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spot-thumbs-"));
        try {
            fs.mkdirSync(path.join(dir, "images", "spots", "thumb"), { recursive: true });
            fs.writeFileSync(path.join(dir, "images", "spots", "thumb", "a.jpg"), "x");
            expect(spotThumbExists("/images/spots/thumb/a.jpg", dir)).toBe(true);
            expect(spotThumbExists("/images/spots/thumb/b.jpg", dir)).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("アプリの行の image.thumbUrl", () => {
    it("土台の行は、写真を出す公開済みの行", () => {
        expect(base.status).toBe("published");
        expect(base.aiCheck?.imageChecked).toBe(true);
    });

    it("サムネが在れば、url と同じ形の絶対 URL で出す", () => {
        const asked: string[] = [];
        const item = toSpotFeedItem(base, images(), (src) => { asked.push(src); return true; });
        expect(asked).toEqual(["/images/spots/thumb/himeji-castle.jpg"]);
        expect(item.image).toMatchObject({
            url: `${siteConfig.url}/images/spots/himeji-castle.jpg`,
            thumbUrl: `${siteConfig.url}/images/spots/thumb/himeji-castle.jpg`,
        });
    });

    it("🔴 サムネが無ければ鍵ごと出さない（null も空文字も出さない）", () => {
        const item = toSpotFeedItem(base, images(), () => false);
        expect(item.image).toBeDefined();
        expect("thumbUrl" in item.image!).toBe(false);
        expect(JSON.stringify(item)).not.toContain("thumbUrl");
    });

    it("サイトに置いていない写真（url が Commons）には付けない。ファイルを見に行きもしない", () => {
        let asked = 0;
        const item = toSpotFeedItem(base, images({ local: undefined }), () => { asked++; return true; });
        expect(item.image!.url).toBe(IMAGE.thumbUrl);
        expect(item.image!.thumbUrl).toBeUndefined();
        expect(asked).toBe(0);
    });

    it("写真を出さない行（下書き）には image ごと無い", () => {
        const item = toSpotFeedItem({ ...base, status: "review" } as Spot, images(), () => true);
        expect(item.image).toBeUndefined();
    });
});

describe("実際に配る JSON（コミット済みの public/images/spots/thumb/）", () => {
    const publicDir = path.join(process.cwd(), "public");
    const items = buildSpotFeed(ledger);
    const withImage = items.filter((i) => i.image);

    it("写真のある行がある（読み取りが空振りしていない）", () => {
        expect(withImage.length).toBeGreaterThan(0);
    });

    it("thumbUrl は、ファイルが在る行に全部付き、無い行には付かない", () => {
        for (const item of withImage) {
            const local = item.image!.url.startsWith(`${siteConfig.url}/images/spots/`)
                ? item.image!.url.slice(siteConfig.url.length)
                : undefined;
            const thumb = local ? spotThumbSrc(local) : undefined;
            const exists = thumb ? fs.existsSync(path.join(publicDir, thumb)) : false;
            if (exists) expect(item.image!.thumbUrl, item.slug).toBe(`${siteConfig.url}${thumb}`);
            else expect(item.image!.thumbUrl, item.slug).toBeUndefined();
        }
    });

    /** 2026-10-08 判断: 古い spots.json を読むのは `thumbUrl` を知らない古いアプリだけ（約 59.5KB 重くなるだけ） */
    it("🔴 古い spots.json（固定した行）には thumbUrl を載せない。写真の url はそのまま", () => {
        const json = spotIndexFeedJson();
        expect(json).not.toContain("thumbUrl");
        const legacy = JSON.parse(json) as { spotId: string; image?: { url: string } }[];
        const full = new Map(withImage.map((i) => [i.spotId, i.image!.url]));
        const legacyWithImage = legacy.filter((i) => i.image);
        expect(legacyWithImage.length).toBeGreaterThan(0);
        for (const i of legacyWithImage) expect(i.image!.url).toBe(full.get(i.spotId));
    });

    it("出している thumbUrl の指すファイルは全部在る（404 を配らない）", () => {
        for (const item of withImage.filter((i) => i.image!.thumbUrl)) {
            const p = item.image!.thumbUrl!.slice(siteConfig.url.length);
            expect(fs.existsSync(path.join(publicDir, p)), item.slug).toBe(true);
        }
    });

    it("区分のファイル・今日の一問の材料に、同じ thumbUrl が載る", () => {
        const sample = withImage.find((i) => i.image!.thumbUrl);
        expect(sample, "サムネの付いた行が1つも無い（コミットし忘れ？）").toBeDefined();
        const thumbUrl = JSON.stringify(sample!.image!.thumbUrl);
        // 区分のファイル（`spot-feed/<区分>.json`）のどれかに載る
        const shards = spotFeedFiles().filter((f) => f !== "index.json").map((f) => spotFeedFileJson(f) ?? "");
        expect(shards.some((j) => j.includes(thumbUrl))).toBe(true);
        // 索引（`spot-feed/index.json`）には写真の URL を載せない（有無だけ）
        expect(spotFeedFileJson("index.json")).not.toContain("thumbUrl");
        // 今日の一問は索引の image をそのまま運ぶ（実際に配る日のファイルにも載る）
        const pool = quizPool(withImage);
        const days = quizDates().map((d) => dailyQuizFor(d)).filter((q) => q !== null);
        expect(days.length).toBeGreaterThan(0);
        expect(days.some((q) => q!.photo.thumbUrl?.startsWith(`${siteConfig.url}/images/spots/thumb/`))).toBe(true);
        const bySpot = new Map(withImage.map((i) => [i.spotId, i.image!.thumbUrl]));
        expect(pool.some((q) => q.image.thumbUrl)).toBe(true);
        for (const q of pool) expect(q.image.thumbUrl, q.slug).toBe(bySpot.get(q.spotId));
    });
});
