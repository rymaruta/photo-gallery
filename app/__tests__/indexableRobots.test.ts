import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { INDEXABLE_ROBOTS, NOINDEX_FOLLOW_ROBOTS, pageRobots } from "../../lib/utils/seo";
import { SPOTS } from "../../lib/data/spots";
import { isPublished, visibleSpots } from "../../lib/utils/spotGuide";
import { spotAreas } from "../../lib/data/spotLink";
import { seasonTopics, themeTopics, countryTopics, seasonView, themeView, countryView, overseasView, topicMetadata } from "../../lib/data/spotTopics";
import { collectionMetadata, collectionIndexMetadata } from "../../lib/server/collections";
import { loadAllPhotos } from "../../lib/server/photos";
import { collectEntries, isIndexableCollection, type CollectionType } from "../../lib/utils/collections";
import { generateMetadata as spotMeta } from "../spots/[slug]/page";
import { generateMetadata as areaMeta } from "../spots/area/[area]/page";
import { generateMetadata as spotsIndexMeta } from "../spots/page";

/**
 * 🔴 **検索に出すページは必ず `INDEXABLE_ROBOTS`（`max-image-preview: large` を含む googlebot の指定）。**
 *
 * 2026-10-22（本番と GSC で確認）: スポット・県・季節・テーマ・タグ・撮影地のページが
 * `robots: indexable ? undefined : { index: false, follow: true }` と書いていた。Next のメタデータ結合は
 * キーが在れば `undefined` でもレイアウトの `robots` を上書きするので、検索に出す側のページで
 * googlebot の指定（画像プレビューの拡大許可）が消えていた。
 *
 * ページの種類ごとに、実際の台帳・写真から「検索に出す」ページを1つ以上選んで metadata を作り、
 * robots が `INDEXABLE_ROBOTS` と同じであることを見る（出さないページは `noindex, follow`）。
 */
type Meta = { robots?: unknown };

function expectRobots(m: Meta, label: string) {
    expect("robots" in m, `${label}: robots のキーが無い（レイアウトの指定に任せる形は、ここでは取らない）`).toBe(true);
    const r = m.robots as { index?: boolean } | undefined;
    expect(r, `${label}: robots が undefined（レイアウトの googlebot の指定を消す）`).toBeTruthy();
    if (r!.index) expect(r, label).toEqual(INDEXABLE_ROBOTS);
    else expect(r, label).toEqual(NOINDEX_FOLLOW_ROBOTS);
}

function expectIndexable(m: Meta, label: string) {
    expectRobots(m, label);
    expect((m.robots as { googleBot?: Record<string, unknown> }).googleBot?.["max-image-preview"], label).toBe("large");
}

describe("pageRobots", () => {
    it("出す側は INDEXABLE_ROBOTS そのもの・出さない側は noindex, follow", () => {
        expect(pageRobots(true)).toBe(INDEXABLE_ROBOTS);
        expect(pageRobots(false)).toEqual({ index: false, follow: true });
        expect(INDEXABLE_ROBOTS.googleBot["max-image-preview"]).toBe("large");
    });
});

describe("検索に出すページの種類ごとに googlebot の指定が残る", () => {
    it("スポット（/spots/<slug>）", async () => {
        const spot = visibleSpots(SPOTS).find(isPublished)!;
        expect(spot).toBeTruthy();
        expectIndexable(await spotMeta({ params: Promise.resolve({ slug: spot.slug }) }) as Meta, spot.slug);
    });

    it("撮影スポットの一覧（/spots）", async () => {
        expectIndexable(await spotsIndexMeta() as Meta, "/spots");
    });

    it("県（/spots/area/<県>）。全県で robots の形を見て、出すものが1つ以上ある", async () => {
        let indexable = 0;
        for (const a of spotAreas()) {
            const m = await areaMeta({ params: Promise.resolve({ area: a.slug }) }) as Meta;
            expectRobots(m, a.slug);
            if ((m.robots as { index?: boolean }).index) indexable++;
        }
        expect(indexable).toBeGreaterThan(0);
        expectRobots(topicMetadata(overseasView()) as Meta, "overseas");
    });

    it("季節（/spots/season/<季節>[/<地方>]）", () => {
        const all = seasonTopics();
        expect(all.length).toBeGreaterThan(0);
        let indexable = 0;
        for (const t of all) {
            const m = topicMetadata(seasonView(t.season, t.area)) as Meta;
            expectRobots(m, `${t.season}/${t.area}`);
            if ((m.robots as { index?: boolean }).index) indexable++;
        }
        expect(indexable).toBeGreaterThan(0);
    });

    it("テーマ（/spots/theme/<種別>/<場所>）", () => {
        const all = themeTopics();
        expect(all.length).toBeGreaterThan(0);
        let indexable = 0;
        for (const t of all) {
            const m = topicMetadata(themeView(t.categorySlug, t.place.slug)) as Meta;
            expectRobots(m, `${t.categorySlug}/${t.place.slug}`);
            if ((m.robots as { index?: boolean }).index) indexable++;
        }
        expect(indexable).toBeGreaterThan(0);
    });

    it("国（/spots/area/overseas/<国>）", () => {
        for (const c of countryTopics()) expectRobots(topicMetadata(countryView(c.code)) as Meta, c.code);
    });

    it.each<CollectionType>(["tag", "location", "category", "camera"])("集約（/%s/<x>）と索引", async (type) => {
        const photos = await loadAllPhotos();
        const entries = collectEntries(photos, type);
        for (const e of entries) {
            const m = await collectionMetadata(type, e.slug) as Meta;
            expectRobots(m, `${type}/${e.slug}`);
            if (isIndexableCollection(e.count, type)) expectIndexable(m, `${type}/${e.slug}`);
        }
        expectRobots(await collectionIndexMetadata(type) as Meta, `/${type}`);
    });
});

describe("書き方を戻さない（ソースの見張り）", () => {
    const ROOT = join(__dirname, "..", "..");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        if (n === "node_modules" || n === "__tests__" || n.startsWith(".")) return [];
        return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
    const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))];

    it("robots に undefined を渡す三項・素の undefined が無い", () => {
        const bad: string[] = [];
        for (const f of files) {
            const src = readFileSync(f, "utf8").split("\n");
            src.forEach((line, i) => {
                if (/^\s*(\/\/|\*)/.test(line)) return;
                if (/\brobots:\s*[^,]*\?\s*undefined\b/.test(line) || /\brobots:\s*[^,]*:\s*undefined\b/.test(line) || /\brobots:\s*undefined\b/.test(line)) {
                    bad.push(`${relative(ROOT, f)}:${i + 1}`);
                }
            });
        }
        expect(bad).toEqual([]);
    });
});
