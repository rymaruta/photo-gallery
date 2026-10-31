import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// **トップの共有カードと検索結果の1枚が、利用者の最新の投稿だった**（2026-10-31・札 journey.photo-ios#432 の 4）。
//
// `resolveOgImage` がビルド時に「一番新しい公開写真」を選び、ルートのレイアウト・トップ・`/q` が
// それを og:image・twitter:image に出していた（子が画像を書かない `/map`・404 なども継ぐ）。
// 本番で `https://journey-photo.com/` の og:image が利用者のスーパーのぶどうの写真になり、
// Google の検索結果にもその写真が出ていた。トップの構造化データ（ImageGallery）の `image` の先頭も同じ写真。
//
// サイトの顔は**投稿に左右されない固定の代表画像**（`SHARE_IMAGE`・1200×630）にする。

// 新着の投稿を「ぶどう」にしておく——直しを戻すと、これが og:image に出て落ちる
const GRAPES = "https://journey-photo.com/uploads/u1/grapes.jpg";
vi.mock("@/lib/server/photos", () => ({
    loadAllPhotos: async () => [
        { id: "old", src: "https://journey-photo.com/uploads/u1/old.jpg", published: true, date: "2024-01-01", createdAt: "2024-01-01T00:00:00Z" },
        { id: "grapes", src: GRAPES, published: true, date: "2026-10-30", createdAt: "2026-10-30T00:00:00Z" },
    ],
    stripPrivateFields: (p: unknown) => p,
}));

const { SHARE_IMAGE, siteConfig, generateHomeStructuredData, generateOrganizationStructuredData } = await import("@/lib/utils/seo");
const SHARE = `${siteConfig.url}${SHARE_IMAGE.path}`;

type OgImage = { url: string; width?: number; height?: number };
function ogImagesOf(m: { openGraph?: unknown }): string[] {
    const imgs = (m.openGraph as { images?: OgImage | OgImage[] } | undefined)?.images;
    return (Array.isArray(imgs) ? imgs : imgs ? [imgs] : []).map((i) => (typeof i === "string" ? i : i.url));
}
function twitterImagesOf(m: { twitter?: unknown }): string[] {
    const imgs = (m.twitter as { images?: string | string[] } | undefined)?.images;
    return Array.isArray(imgs) ? imgs : imgs ? [imgs] : [];
}

/** JPEG の SOF から寸法を読む（画像の道具を足さない） */
function jpegSize(buf: Buffer): { width: number; height: number } {
    let i = 2;
    while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
    }
    throw new Error("SOF が無い");
}

describe("サイトの固定の代表画像（SHARE_IMAGE）", () => {
    it("public に実在する 1200×630 の JPEG", () => {
        const file = join(process.cwd(), "public", SHARE_IMAGE.path);
        expect(existsSync(file), `public${SHARE_IMAGE.path} が無い`).toBe(true);
        const buf = readFileSync(file);
        expect(buf.subarray(0, 2).toString("hex")).toBe("ffd8");
        expect(jpegSize(buf)).toEqual({ width: SHARE_IMAGE.width, height: SHARE_IMAGE.height });
        expect([SHARE_IMAGE.width, SHARE_IMAGE.height]).toEqual([1200, 630]);
    });

    it("利用者の投稿（/uploads/）を指さない", () => {
        expect(SHARE_IMAGE.path).not.toMatch(/uploads/);
    });
});

describe("トップ・ルート・/q の og:image は投稿に左右されない", () => {
    it("ルートのレイアウト（子が画像を書かない頁が継ぐ）", async () => {
        const { generateMetadata } = await import("@/app/layout");
        const m = await generateMetadata();
        expect(ogImagesOf(m), "新着の投稿が共有カードに出ている").toEqual([SHARE]);
        expect(twitterImagesOf(m)).toEqual([SHARE]);
        const og = (m.openGraph as { images: OgImage[] }).images[0];
        expect([og.width, og.height]).toEqual([1200, 630]);
        // レイアウトは部品を多く読み込む（単独で約 3.5 秒）。全体と並ぶと既定の 5 秒を超えるので延ばす
    }, 30_000);

    it("トップ（/）", async () => {
        const { generateMetadata } = await import("@/app/page");
        const m = await generateMetadata();
        expect(ogImagesOf(m)).toEqual([SHARE]);
        expect(twitterImagesOf(m)).toEqual([SHARE]);
    }, 30_000);

    it("今日の一問（/q）", async () => {
        const { generateMetadata } = await import("@/app/q/layout");
        const m = await generateMetadata();
        expect(ogImagesOf(m)).toEqual([SHARE]);
        expect(twitterImagesOf(m)).toEqual([SHARE]);
    });

    it("規約・プライバシー（子の openGraph が親の画像を消していた）", async () => {
        for (const mod of [await import("@/app/terms/page"), await import("@/app/privacy/page")]) {
            expect(ogImagesOf(mod.metadata)).toEqual([SHARE]);
        }
    }, 30_000);
});

describe("トップの構造化データ（ImageGallery）", () => {
    const photos = [
        { id: "grapes", src: GRAPES, title: "ぶどう" },
        { id: "old", src: "https://journey-photo.com/uploads/u1/old.jpg", title: "古い写真" },
    ];

    it("代表の1枚（primaryImageOfPage・image の先頭）は固定の代表画像", () => {
        const data = generateHomeStructuredData(photos) as Record<string, unknown>;
        const primary = data.primaryImageOfPage as { contentUrl: string; width: number; height: number };
        expect(primary.contentUrl).toBe(SHARE);
        expect([primary.width, primary.height]).toEqual([1200, 630]);
        expect(data.thumbnailUrl).toBe(SHARE);
        const image = data.image as Array<{ contentUrl: string }>;
        expect(image[0].contentUrl, "新着の投稿が代表の1枚になっている").toBe(SHARE);
    });

    it("ギャラリーの写真の並びは残す（代表のあと）", () => {
        const data = generateHomeStructuredData(photos) as Record<string, unknown>;
        const image = data.image as Array<{ contentUrl: string }>;
        expect(image.slice(1).map((i) => i.contentUrl)).toEqual([GRAPES, "https://journey-photo.com/uploads/u1/old.jpg"]);
    });

    it("トップの頁はこの関数で構造化データを組む", () => {
        const src = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8").replace(/\/\/[^\n]*/g, "");
        expect(src).toMatch(/generateHomeStructuredData\(/);
        expect(src).not.toMatch(/generateStructuredData\(/);
    });
});

// ロゴ（Organization.logo）は正方形のアイコンのまま——共有カードの画像とは別物
describe("siteConfig.ogImage（ロゴ）", () => {
    it("public に実在するファイルを指し、Organization.logo が使う", () => {
        expect(siteConfig.ogImage.startsWith("/"), "相対パスであること").toBe(true);
        expect(existsSync(join(process.cwd(), "public", siteConfig.ogImage)),
            `public${siteConfig.ogImage} が存在しない`).toBe(true);
        const logo = (generateOrganizationStructuredData() as { logo: { url: string } }).logo;
        expect(logo.url).toBe(`${siteConfig.url}${siteConfig.ogImage}`);
    });
});
