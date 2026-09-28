import { describe, it, expect, vi } from "vitest";
import rawLedger from "../../content/spots.json";
import type { Spot } from "../../lib/data/spots";
import { buildSpotFeed, spotIndexFeed, spotIndexFeedJson, toSpotFeedItem } from "../../lib/data/spotFeed";
import type { SpotImage } from "../../lib/data/spotImages";
import * as route from "../app/data/spots.json/route";
import fs from "node:fs";
import path from "node:path";
import { siteConfig } from "../../lib/utils/seo";

/**
 * **アプリが読む索引（`/app/data/spots.json`）の形を固定する。**
 *
 * iOS は鍵の集合を前提に読む（知らない鍵は無視・壊れた行は落とす）。
 * ここで固定するのは:
 *   1. 鍵の集合（重い項目・製品名・確認者を運ばない）
 *   2. `stage` と `draftedAt` が必ずある。`verifiedAt` は人が確かめた行だけ
 *   3. 実際の台帳で作った索引は公開済みだけ・大きさと、`**` が無いこと
 *   4. route が force-static で、CLI と同じ文字列を返す
 */
const ledger = vi.hoisted(() => ({ spots: [] as unknown[] }));
vi.mock("../../lib/data/spots", () => ({ get SPOTS() { return ledger.spots; } }));

function spot(slug: string, over: Partial<Spot> = {}): Spot {
    return {
        spotId: `sp_${slug.padEnd(12, "0").slice(0, 12)}`,
        slug,
        name: slug,
        nameEn: `${slug} en`,
        reading: "よみ",
        aliases: ["別名"],
        address: "住所",
        summary: "あ".repeat(40),
        description: "長い説明",
        highlights: ["見どころ"],
        seasonalGuide: [{ season: "spring", text: "春" }],
        compositionTips: ["構図"],
        region: { country: "日本", prefecture: "香川県", city: "観音寺市" },
        coords: { lat: 34.1, lng: 133.6 },
        category: "寺社",
        officialWebsiteUrl: "https://example.example/",
        status: "review",
        draftedAt: "2026-09-24",
        draftedBy: "claude",
        sources: [{ field: "access", url: "https://example.example/a", checkedAt: "2026-09-24" }],
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
        ...over,
    };
}

const ALLOWED = ["spotId", "slug", "name", "nameEn", "reading", "region", "coords", "category", "summary", "stage", "draftedAt", "verifiedAt", "image", "seasonalGuide"];

/** 写真の記録（`content/spot-images.json` の1行）。既定は人が確かめていない */
function image(over: Partial<SpotImage> = {}): SpotImage {
    return {
        wikidata: "Q1", file: "File:A.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
        thumbUrl: "https://upload.wikimedia.org/a/640px-A.jpg", author: "撮った人", license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", method: "wikidata-P18", fetchedAt: "2026-09-26",
        reviewedBy: null, ...over,
    };
}

describe("アプリ向けの索引", () => {
    it("鍵の集合が固定されている（重い項目・製品名・確認者を運ばない）", () => {
        ledger.spots = [
            spot("draft"),
            spot("verified", { status: "published", verifiedBy: "運営", verifiedAt: "2026-09-25", draftedAt: undefined }),
            spot("hidden", { status: "draft" }),
        ];
        // 配るのは公開済みだけ（`BUILD_DRAFT_SPOTS`）。下書きの形は toSpotFeedItem で見る
        expect(spotIndexFeed().map((s) => s.slug)).toEqual(["verified"]);
        const items = [...spotIndexFeed(), toSpotFeedItem(ledger.spots[0] as Spot)];
        for (const item of items) {
            const extra = Object.keys(item).filter((k) => !ALLOWED.includes(k));
            expect(extra, `${item.slug} に余計な鍵`).toEqual([]);
        }
        const json = spotIndexFeedJson();
        for (const banned of ["draftedBy", "verifiedBy", "sources", "description", "highlights", "claude", "aliases", "address"]) {
            expect(json, `${banned} が索引に乗っている`).not.toContain(banned);
        }
    });

    it("stage と draftedAt は必ず、verifiedAt は人が確かめた行だけ", () => {
        const draft = toSpotFeedItem(spot("draft", { verifiedAt: "2026-09-24" }));
        const verified = toSpotFeedItem(spot("verified", { status: "published", verifiedBy: "運営", verifiedAt: "2026-09-25" }));
        expect(draft.stage).toBe("review");
        expect(draft.draftedAt).toBe("2026-09-24");
        expect("verifiedAt" in draft, "確認者の無い行の日付を運んでいる").toBe(false);
        expect(verified.stage).toBe("published");
        expect(verified.verifiedAt).toBe("2026-09-25");
        expect(verified.region).toEqual({ prefecture: "香川県", city: "観音寺市" });
    });

    it("写真は、公開済みで owner が写真を確かめた行だけ。作者とライセンスを必ず一緒に運ぶ", () => {
        const pub = { status: "published" as const, verifiedBy: "運営", verifiedAt: "2026-09-25" };
        const images = {
            ok: image({ reviewedBy: "rymaruta", reviewedAt: "2026-09-26" }),
            unreviewed: image(),
            draft: image({ reviewedBy: "rymaruta" }),
        };
        const ok = toSpotFeedItem(spot("ok", pub), images);
        expect(ok.image).toEqual({
            url: "https://upload.wikimedia.org/a/640px-A.jpg", author: "撮った人", license: "CC BY-SA 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
        });
        // 🔴 機械が選んだだけ（reviewedBy が空）の写真は出さない
        expect("image" in toSpotFeedItem(spot("unreviewed", pub), images)).toBe(false);
        // 🔴 下書きには写真を付けない（本文と同じく運営が確かめていない行）
        expect("image" in toSpotFeedItem(spot("draft"), images)).toBe(false);
        // 写真の無いスポットには鍵ごと出さない
        expect("image" in toSpotFeedItem(spot("none", pub), images)).toBe(false);
    });

    /// AI 照合（owner の委任）の行は公開済み。**人の確認日は運ばない**。
    /// 写真は「写真も照らした」印があり、座標のずれが無いときだけ
    it("AI 照合の行は公開済みとして載り、verifiedAt は運ばない。写真は照らしたものだけ", () => {
        const ai = {
            status: "published" as const,
            aiCheck: { checkedAt: "2026-09-26", delegatedBy: "rymaruta", sources: [{ url: "https://ja.wikipedia.org/wiki/x", title: "x" }] },
        };
        const images = { a: image(), b: image(), c: image({ coordsMismatch: true }) };
        const withPhoto = toSpotFeedItem(spot("a", { ...ai, aiCheck: { ...ai.aiCheck, imageChecked: true } }), images);
        expect(withPhoto.stage).toBe("published");
        expect("verifiedAt" in withPhoto, "AI 照合の行に人の確認日を運んでいる").toBe(false);
        expect(withPhoto.image?.url).toBe("https://upload.wikimedia.org/a/640px-A.jpg");
        expect("image" in toSpotFeedItem(spot("b", ai), images), "写真を照らしていないのに出している").toBe(false);
        expect("image" in toSpotFeedItem(spot("c", { ...ai, aiCheck: { ...ai.aiCheck, imageChecked: true } }), images),
            "座標のずれた写真を出している").toBe(false);
    });

    /// 季節の案内（2026-09-27）。アプリの「いつ行く？」「いまが見頃」用。**下書きには載せない**
    it("季節の案内は公開済みの行だけに載り、台帳の文のまま", () => {
        const pub = toSpotFeedItem(spot("p", { status: "published", verifiedBy: "運営", verifiedAt: "2026-09-25" }));
        expect(pub.seasonalGuide).toEqual([{ season: "spring", text: "春" }]);
        expect("seasonalGuide" in toSpotFeedItem(spot("d")), "下書きの季節の文を運んでいる").toBe(false);
        const none = toSpotFeedItem(spot("n", { status: "published", verifiedBy: "運営", verifiedAt: "2026-09-25", seasonalGuide: [] }));
        expect("seasonalGuide" in none, "空の季節を鍵ごと出している").toBe(false);
    });

    it("undefined の鍵は出さない（`\"x\": null` を作らない）", () => {
        const item = toSpotFeedItem(spot("bare", { nameEn: undefined, reading: undefined, category: undefined, coords: undefined }));
        expect(Object.keys(item).sort()).toEqual(["draftedAt", "name", "region", "slug", "spotId", "stage", "summary"]);
    });

    it("route は force-static で、GET は同じ文字列を JSON として返す", async () => {
        const pub = { status: "published" as const, verifiedBy: "運営", verifiedAt: "2026-09-25" };
        ledger.spots = [spot("a", pub), spot("b", pub), spot("c")];
        expect(route.dynamic).toBe("force-static");
        const res = route.GET();
        expect(res.headers.get("Content-Type")).toContain("application/json");
        expect(await res.text()).toBe(spotIndexFeedJson());
        expect(JSON.parse(await route.GET().text())).toHaveLength(2);
    });
});

describe("実際の台帳で作った索引", () => {
    const items = buildSpotFeed(rawLedger as unknown as Spot[]);
    const json = JSON.stringify(items);

    it("公開済みだけが載る（下書きはアプリにも配らない）", () => {
        const published = (rawLedger as unknown as Spot[]).filter((s) => s.status === "published");
        expect(items.map((s) => s.slug).sort()).toEqual(published.map((s) => s.slug).sort());
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((s) => s.stage === "published")).toBe(true);
        // 人の確認日を運ぶのは人が確かめた行だけ（AI 照合の行は持たない）
        const human = (rawLedger as unknown as Spot[]).filter((s) => s.status === "published" && s.verifiedBy).map((s) => s.slug).sort();
        expect(items.filter((s) => s.verifiedAt).map((s) => s.slug).sort()).toEqual(human);
    });

    /// 写真が付くのは「owner が写真を確かめた行」と「AI 照合で写真も照らした行」だけ
    it("写真は、owner が確かめたか AI 照合で照らした行だけに付く（2026-09-26）", () => {
        const withImage = items.filter((s) => s.image);
        const ledger = rawLedger as unknown as Spot[];
        const expected = ledger
            .filter((s) => s.status === "published")
            .filter((s) => ["kiyosumi-keiryu-hiroba", "kobe-kitano-ijinkan", "nabegataki", "takaya-jinja"].includes(s.slug)
                || s.aiCheck?.imageChecked === true)
            .map((s) => s.slug).sort();
        expect(withImage.map((s) => s.slug).sort()).toEqual(expected);
        expect(withImage.length, "owner の4件が消えている").toBeGreaterThanOrEqual(4);
        for (const s of withImage) {
            expect(s.image!.author, s.slug).toBeTruthy();
            expect(s.image!.license, s.slug).toBeTruthy();
            // **サイトに置いた縮小版を指し、そのファイルが実在する**（元画像は数MBある）
            expect(s.image!.url, s.slug).toBe(`${siteConfig.url}/images/spots/${s.slug}.jpg`);
            expect(fs.existsSync(path.join(process.cwd(), "public", "images", "spots", `${s.slug}.jpg`)), s.slug).toBe(true);
        }
    });

    /** 目安は 850KB（minify・gzip 前）。超えたら項目か件数を見直す */
    it("大きさが目安に収まり、`**` が無い", () => {
        const bytes = Buffer.byteLength(json, "utf8");
        expect(bytes, `索引が ${bytes} バイト`).toBeLessThan(850_000);
        expect(json).not.toContain("**");
        expect(json).not.toContain("claude");
    });
});
