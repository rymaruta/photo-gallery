import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import rawLedger from "../../../content/spots.json";
import legacyFreeze from "../../../content/spots-feed-legacy.json";
import type { Spot } from "../spots";
import type { SpotImage } from "../spotImages";
import { buildSpotFeed, legacySpotFeed, LEGACY_SPOT_IDS, toSpotFeedItem } from "../spotFeed";
import {
    buildSpotShardFeed, fingerprint, shardKey, spotFeedFileJson, spotFeedFiles, spotShardFeed,
    COUNTRY_SHARD_KEYS, OTHER_KEY, SPOT_FEED_VERSION,
} from "../spotFeedShards";
import * as route from "../../../app/app/data/spot-feed/[file]/route";

/**
 * **数を増やした撮影スポットの置き場**（`/app/data/spot-feed/`・2026-10-07・`docs/spot-feed-sharding.md`）。
 *
 * 見張るもの:
 *   1. 索引と詳細が食い違わない（索引の全行が、その `shard` の詳細に1回だけ在る・詳細は `spots.json` の行と同じ）
 *   2. 索引に文を入れない（季節・時間帯は種類だけ・写真は有無だけ）
 *   3. 大きさの上限（索引の1行・区分の1つ）
 *   4. 古いアプリの `spots.json` は固定した行のまま、今の上限に収まる
 *   5. 区分の指紋が iOS の `ValidatorStore.fingerprint` と同じ式
 */

const ledger = rawLedger as unknown as Spot[];

/** 索引の全行（区分の鍵つき） */
function indexRows(index: { shards: { key: string; spots: { spotId: string; slug: string }[] }[] }) {
    return index.shards.flatMap((s) => s.spots.map((row) => ({ ...row, shard: s.key })));
}

function spot(slug: string, over: Partial<Spot> = {}): Spot {
    return {
        spotId: `sp_${slug.padEnd(12, "0").slice(0, 12)}`,
        slug,
        name: slug,
        nameEn: `${slug} en`,
        reading: "よみ",
        aliases: ["別名", " "],
        summary: "概要の文" + "あ".repeat(40),
        description: "長い説明",
        seasonalGuide: [{ season: "spring", text: "春の文" }, { season: "autumn", text: "秋の文" }],
        timeOfDayGuide: [{ time: "goldenHour", text: "夕日の文" }],
        region: { country: "日本", prefecture: "東京都", city: "千代田区" },
        coords: { lat: 35.68, lng: 139.76 },
        category: "建築",
        highlights: ["見どころ"],
        officialWebsiteUrl: "https://example.example/",
        sources: [{ field: "access", url: "https://example.example/a", checkedAt: "2026-09-24" }],
        status: "published",
        verifiedBy: "運営",
        verifiedAt: "2026-09-25",
        draftedAt: "2026-09-24",
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
        ...over,
    } as Spot;
}

const image: SpotImage = {
    wikidata: "Q1", file: "File:A.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
    thumbUrl: "https://upload.wikimedia.org/a/640px-A.jpg", author: "撮った人", license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", method: "wikidata-P18", fetchedAt: "2026-09-26",
    reviewedBy: "rymaruta", reviewedAt: "2026-09-26",
} as SpotImage;

describe("区分の鍵", () => {
    it("日本は地方、海外は国（ISO の2文字）", () => {
        expect(shardKey({ region: { prefecture: "東京都" } })).toBe("jp-kanto");
        expect(shardKey({ region: { prefecture: "北海道" } })).toBe("jp-hokkaido");
        expect(shardKey({ region: { prefecture: "沖縄県" } })).toBe("jp-kyushu");
        expect(shardKey({ region: { country: "フランス", prefecture: "イヴリーヌ県" } })).toBe("fr");
        expect(shardKey({ region: { country: "日本", prefecture: "京都府" } })).toBe("jp-kinki");
    });

    it("表に無い国・県の分からない日本の行も、どこかの区分に入る（落とさない）", () => {
        expect(shardKey({ region: { country: "どこかの国" } })).toBe(OTHER_KEY);
        expect(shardKey({ region: {} })).toBe("jp-other");
    });

    it("鍵は綴り [a-z0-9-] だけ（ファイル名・URL に使う）", () => {
        for (const key of Object.values(COUNTRY_SHARD_KEYS)) expect(key).toMatch(/^[a-z]{2}$/);
        for (const s of spotShardFeed().index.shards) expect(s.key).toMatch(/^[a-z0-9-]+$/);
    });
});

describe("索引と詳細（固定の台帳）", () => {
    const spots = [
        spot("tokyo-a"),
        spot("paris-b", { region: { country: "フランス", prefecture: "パリ", city: "パリ" }, seasonalGuide: [], timeOfDayGuide: [] }),
        spot("kyoto-c", { region: { country: "日本", prefecture: "京都府", city: "京都市" } }),
        spot("draft-d", { status: "review" }),
    ];
    const images = { "kyoto-c": image } as Record<string, SpotImage>;
    const feed = buildSpotShardFeed(spots, images);

    it("索引は配る行の全部。版と区分の表を持つ", () => {
        expect(feed.index.v).toBe(SPOT_FEED_VERSION);
        const slugs = indexRows(feed.index).map((s) => s.slug);
        expect(slugs.sort()).toEqual(buildSpotFeed(spots, images).map((s) => s.slug).sort());
        expect(slugs).not.toContain("draft-d");
        expect(feed.index.shards.map((s) => s.key)).toEqual(["fr", "jp-kanto", "jp-kinki"]);
    });

    it("索引の全行が、その区分の詳細に1回だけ在り、詳細の行は spots.json の行と同じ中身", () => {
        for (const row of indexRows(feed.index)) {
            const detail = JSON.parse(feed.shardJson.get(row.shard)!) as { spotId: string }[];
            expect(detail.filter((d) => d.spotId === row.spotId), row.slug).toHaveLength(1);
        }
        const total = [...feed.shardJson.values()].reduce((n, j) => n + JSON.parse(j).length, 0);
        expect(total, "詳細に索引に無い行がある").toBe(indexRows(feed.index).length);
        const kyoto = JSON.parse(feed.shardJson.get("jp-kinki")!)[0];
        expect(kyoto).toEqual(JSON.parse(JSON.stringify(toSpotFeedItem(spots[2], images))));
    });

    it("区分の表（件数・大きさ・指紋）は配るファイルと合う", () => {
        for (const info of feed.index.shards) {
            const json = feed.shardJson.get(info.key)!;
            expect(info.count).toBe(JSON.parse(json).length);
            expect(info.bytes).toBe(Buffer.byteLength(json, "utf8"));
            expect(info.hash).toBe(fingerprint(json));
            // 索引の行と詳細の行は同じ並び・同じ数
            expect(info.spots.map((r) => r.spotId)).toEqual(JSON.parse(json).map((d: { spotId: string }) => d.spotId));
        }
    });

    /// 時刻帯（`timeZone`・2026-10-07 に台帳へ足した）は**詳細にだけ**載る（光の時刻はスポットの画面で使う）
    it("timeZone は詳細の行に載り、索引には載らない", () => {
        const taipei = spot("taipei-e", { region: { country: "台湾", prefecture: "台北市" }, timeZone: "Asia/Taipei" } as Partial<Spot>);
        const tz = buildSpotShardFeed([taipei], {});
        const key = tz.index.shards[0].key;
        expect(JSON.parse(tz.shardJson.get(key)!)[0].timeZone).toBe("Asia/Taipei");
        expect(JSON.stringify(tz.index)).not.toContain("timeZone");
    });

    it("索引に文を入れない。季節・時間帯は種類、写真は有無、別名は空を落とす", () => {
        const tokyo = feed.index.shards.find((s) => s.key === "jp-kanto")!.spots.find((s) => s.slug === "tokyo-a")!;
        expect(tokyo).toEqual({
            spotId: "sp_tokyo-a00000", slug: "tokyo-a", name: "tokyo-a", nameEn: "tokyo-a en", reading: "よみ",
            aliases: ["別名"], region: { prefecture: "東京都", city: "千代田区" }, coords: { lat: 35.68, lng: 139.76 },
            category: "建築", stage: "published", seasons: ["spring", "autumn"], times: ["goldenHour"],
        });
        const rows = feed.index.shards.flatMap((s) => s.spots);
        expect(rows.find((s) => s.slug === "kyoto-c")!.hasImage).toBe(true);
        expect("hasImage" in tokyo, "写真の無い行に有ると書いている").toBe(false);
        const paris = rows.find((s) => s.slug === "paris-b")!;
        expect("seasons" in paris || "times" in paris || "hasImage" in paris, "空の種類を鍵ごと出している").toBe(false);
        const json = JSON.stringify(feed.index);
        for (const banned of ["春の文", "夕日の文", "概要の文", "summary", "image\"", "draftedAt", "verifiedAt", "長い説明"]) {
            expect(json, `${banned} が索引に乗っている`).not.toContain(banned);
        }
    });
});

describe("指紋（iOS の ValidatorStore.fingerprint と同じ式）", () => {
    it("長さ + FNV-1a 64 ビットの16進", () => {
        // FNV-1a 64 の公開されている検査値
        expect(fingerprint("")).toBe("0-cbf29ce484222325");
        expect(fingerprint("a")).toBe("1-af63dc4c8601ec8c");
        expect(fingerprint("foobar")).toBe("6-85944171f73967e8");
        // 長さは UTF-8 のバイト数（iOS は Data の長さ）
        expect(fingerprint("春").startsWith("3-")).toBe(true);
    });
});

describe("実際の台帳", () => {
    const feed = spotShardFeed();
    const indexJson = JSON.stringify(feed.index);
    const published = ledger.filter((s) => s.status === "published");

    it("公開済みの全行が索引に載り、国の分からない区分に落ちた行は無い", () => {
        const rows = indexRows(feed.index);
        expect(rows.map((s) => s.spotId).sort()).toEqual(published.map((s) => s.spotId).sort());
        const lost = (rows as unknown as { shard: string; slug: string; region: { country?: string; prefecture?: string } }[]).filter((s) => s.shard === OTHER_KEY || s.shard === "jp-other").map((s) => `${s.slug}(${s.region.country ?? s.region.prefecture})`);
        expect(lost, "COUNTRY_SHARD_KEYS に国を足す・県の綴りを直す").toEqual([]);
    });

    /** 確認中の行も含め、台帳に出る国は全部区分の鍵を持つ（公開した日に `other` に落ちない） */
    it("台帳に出る国は全部 COUNTRY_SHARD_KEYS にある", () => {
        const missing = [...new Set(ledger.map((s) => s.region?.country?.trim()).filter((c): c is string => !!c && c !== "日本"))]
            .filter((c) => !COUNTRY_SHARD_KEYS[c]);
        expect(missing, "COUNTRY_SHARD_KEYS に国を足す").toEqual([]);
        expect(new Set(Object.values(COUNTRY_SHARD_KEYS)).size, "鍵が重なっている").toBe(Object.keys(COUNTRY_SHARD_KEYS).length);
    });

    /**
     * 索引の1行の目安は 400 バイト（minify）。2026-10-07 の実測は約 360 バイト（gzip 込みで約 80 バイト）。
     * 1万件で約 3.6MB（gzip 約 0.8MB）。超えるなら項目を見直すか、索引も地域で割る（設計の文書）
     */
    it("索引の1行あたりの大きさが目安に収まる", () => {
        const perRow = Buffer.byteLength(indexJson, "utf8") / indexRows(feed.index).length;
        expect(perRow, `索引が1行 ${perRow.toFixed(0)} バイト`).toBeLessThan(400);
        expect(Buffer.byteLength(indexJson, "utf8"), "索引そのものの上限（4MB・1万件まで）").toBeLessThan(4_000_000);
        expect(zlib.gzipSync(indexJson).length).toBeLessThan(1_000_000);
    });

    /** 区分1つの上限は 500KB（minify）。超えたら区分を割る（日本は地方 → 県・`shardKey`） */
    it("区分の1つが上限に収まる", () => {
        for (const s of feed.index.shards) {
            expect(s.bytes, `${s.key} が ${s.bytes} バイト。区分を割る（shardKey）`).toBeLessThan(500_000);
        }
    });

    it("配るファイルの一覧と中身が route と合う（索引・各区分・無い名前は 404）", async () => {
        expect(route.dynamic).toBe("force-static");
        expect(route.generateStaticParams().map((p) => p.file)).toEqual(spotFeedFiles());
        expect(spotFeedFiles()).toContain("index.json");
        for (const file of spotFeedFiles()) {
            const res = await route.GET(new Request("https://x.example"), { params: Promise.resolve({ file }) });
            expect(res.headers.get("Content-Type")).toContain("application/json");
            expect(await res.text()).toBe(spotFeedFileJson(file));
        }
        const missing = await route.GET(new Request("https://x.example"), { params: Promise.resolve({ file: "nope.json" }) });
        expect(missing.status).toBe(404);
        expect(spotFeedFileJson("../spots.json")).toBeUndefined();
    });
});

describe("古いアプリの spots.json（2026-10-07 に固定）", () => {
    const items = buildSpotFeed(ledger);

    /** 🔴 **一覧を増やさない。** 増やすと古いアプリの索引が上限（950KB）を超える */
    it("固定した行は 1,079 件のまま", () => {
        expect((legacyFreeze as { frozenAt: string }).frozenAt).toBe("2026-10-07");
        expect(LEGACY_SPOT_IDS.size).toBe(1079);
    });

    it("固定した行のうち配っているものは全部載り、それ以外は載らない。今の上限に収まる", () => {
        const legacy = legacySpotFeed(items);
        expect(legacy.every((s) => LEGACY_SPOT_IDS.has(s.spotId))).toBe(true);
        expect(legacy.map((s) => s.spotId).sort()).toEqual(items.filter((s) => LEGACY_SPOT_IDS.has(s.spotId)).map((s) => s.spotId).sort());
        expect(Buffer.byteLength(JSON.stringify(legacy), "utf8")).toBeLessThan(950_000);
    });
});
