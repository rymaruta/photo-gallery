import { describe, it, expect } from "vitest";
import { SPOTS, type Spot } from "../spots";
import {
    CATEGORY_SLUGS, REGION_SLUGS, MIN_TOPIC_SPOTS, MIN_INDEXABLE_COUNTRY, SEASONS,
    topicSpots, countryTopics, themeTopics, seasonTopics,
    countryView, themeView, seasonView, overseasView,
    topicStructuredData, topicTitle, topicMetadata, topicLinksForSpot, spotIndexTopics,
    homeSeasonalSpots, seasonOfMonth, SEASON_TOP_CARDS, spotTopicSitemapEntries, themePath, seasonPath,
} from "../spotTopics";
import { prefectureByName, OVERSEAS_SLUG } from "../prefectures";
import { siteConfig } from "../../utils/seo";

/**
 * **撮影スポットの切り口の頁（国・テーマ・季節）**（2026-10-11）。
 * 本物の台帳で確かめる（`spotSeo.test.ts` と同じ理由）。作り物が要る所は、
 * 公開済みの行を写して項目だけ変える（公開の門を通る行を一から作らない）。
 */

const shown = topicSpots();
const jp = (s: Spot) => s.region?.country === "日本";

/** 公開済みの行を写して、鍵・綴りと指定の項目だけ変える */
let seq = 0;
function clone(base: Spot, patch: Partial<Spot>): Spot {
    seq++;
    return { ...base, spotId: `sp_test${String(seq).padStart(8, "0")}`, slug: `test-topic-${seq}`, ...patch };
}
const kyotoBase = shown.find((s) => s.region?.prefecture === "京都府")!;

describe("前提", () => {
    it("台帳に公開済みの行がある（無いとこのファイルの全部が素通りする）", () => {
        expect(shown.length).toBeGreaterThan(100);
        expect(kyotoBase).toBeTruthy();
    });
});

describe("カテゴリと地方の綴り", () => {
    it("頁になる件数のカテゴリは、全部 URL の綴りを持つ（表に無いと頁が黙って消える）", () => {
        // 表を使わずに数える: 県・地方・国の組で MIN_TOPIC_SPOTS 件以上になるカテゴリ
        const counts = new Map<string, number>();
        for (const s of shown) {
            const c = s.category?.trim();
            if (!c) continue;
            const pref = jp(s) ? prefectureByName(s.region?.prefecture) : null;
            const keys = jp(s) ? [pref?.name, pref?.region] : [s.region?.country];
            for (const k of keys) if (k) counts.set(`${c}|${k}`, (counts.get(`${c}|${k}`) ?? 0) + 1);
        }
        const needed = new Set([...counts].filter(([, n]) => n >= MIN_TOPIC_SPOTS).map(([k]) => k.split("|")[0]));
        const missing = [...needed].filter((c) => !CATEGORY_SLUGS[c]);
        expect(missing).toEqual([]);
        expect(needed.size).toBeGreaterThan(10);
    });

    it("綴りは重ならず、URL にそのまま使える形", () => {
        const slugs = Object.values(CATEGORY_SLUGS);
        expect(new Set(slugs).size).toBe(slugs.length);
        for (const s of [...slugs, ...Object.values(REGION_SLUGS)]) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });
});

describe("テーマ（カテゴリ × 地域）", () => {
    const themes = themeTopics();

    it("どの頁も MIN_TOPIC_SPOTS 件以上・中身は全部そのカテゴリ（薄い頁を作らない）", () => {
        expect(themes.length).toBeGreaterThan(20);
        for (const t of themes) {
            expect(t.spots.length, themePath(t)).toBeGreaterThanOrEqual(MIN_TOPIC_SPOTS);
            for (const s of t.spots) expect(s.category).toBe(t.category);
        }
    });

    it("4件の組は頁にならず、5件で頁になる", () => {
        const four = Array.from({ length: 4 }, () => clone(kyotoBase, { category: "灯台" }));
        expect(themeTopics([...four]).some((t) => t.category === "灯台")).toBe(false);
        const five = [...four, clone(kyotoBase, { category: "灯台" })];
        const got = themeTopics(five).filter((t) => t.category === "灯台").map((t) => themePath(t));
        expect(got).toContain("/spots/theme/lighthouses/kyoto");
    });

    it("URL が重ならない（地方と県が同じ顔ぶれ＝北海道は地方の側を作らない）", () => {
        const paths = themes.map(themePath);
        expect(new Set(paths).size).toBe(paths.length);
        const hokkaido = Array.from({ length: 5 }, () => clone(shown.find((s) => s.region?.prefecture === "北海道")!, { category: "灯台" }));
        const got = themeTopics(hokkaido).map(themePath);
        expect(got).toEqual(["/spots/theme/lighthouses/hokkaido"]);
    });

    it("県・地方・国の3段がそろう（京都府の寺社・近畿の寺社・フランスの教会）", () => {
        const paths = themes.map(themePath);
        expect(paths).toContain("/spots/theme/temples-shrines/kyoto");
        expect(paths).toContain("/spots/theme/temples-shrines/kinki");
        expect(paths).toContain("/spots/theme/churches/fr");
    });

    it("頁の題・導入文はデータの事実（件数と先頭のスポット名）", () => {
        const v = themeView("temples-shrines", "kyoto")!;
        const n = shown.filter((s) => s.category === "寺社" && s.region?.prefecture === "京都府").length;
        expect(v.heading).toBe("京都府の寺社の撮影スポット");
        expect(topicTitle(v)).toBe(`京都府の寺社の撮影スポット${n}選`);
        expect(v.intro).toContain(`${n}件`);
        expect(v.intro).toContain(v.cards[0].name);
        // パンくずは県の一覧を通る
        expect(v.crumbs).toEqual([{ name: "京都府", href: "/spots/area/kyoto" }]);
    });

    it("在らない組は null（頁を作らない）", () => {
        expect(themeView("temples-shrines", "nowhere")).toBeNull();
        expect(themeView("no-such-category", "kyoto")).toBeNull();
    });
});

describe("国", () => {
    const countries = countryTopics();

    it("海外の公開済みの行は、ちょうど1つの国の頁に入る", () => {
        const overseas = shown.filter((s) => !jp(s));
        expect(countries.reduce((n, c) => n + c.spots.length, 0)).toBe(overseas.length);
        const ids = countries.flatMap((c) => c.spots.map((s) => s.spotId));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("🔴 `/spots/area/overseas` は国の一覧で、スポットのカードを積まない（814件 1.3MB に戻さない）", () => {
        const v = overseasView();
        expect(v.cards).toEqual([]);
        expect(v.related[0].links.length).toBe(countries.length);
        expect(v.related[0].links[0]).toMatchObject({ href: `/spots/area/overseas/${countries[0].code}`, count: countries[0].spots.length });
        // 構造化データは並べている国のリンク
        const { itemList } = topicStructuredData(v);
        expect(itemList?.itemListElement.length).toBe(countries.length);
    });

    it("1件の国は頁を建てるが検索に出さない（noindex・サイトマップ外）", () => {
        const one = countries.find((c) => c.spots.length < MIN_INDEXABLE_COUNTRY);
        expect(one, "1件の国が台帳から消えたらこの項は別の作り物で確かめる").toBeTruthy();
        const v = countryView(one!.code)!;
        expect(v.indexable).toBe(false);
        expect(topicMetadata(v).robots).toEqual({ index: false, follow: true });
        expect(spotTopicSitemapEntries().map((e) => e.url)).not.toContain(`${siteConfig.url}/spots/area/overseas/${one!.code}`);
        const big = countryView("fr")!;
        expect(big.indexable).toBe(true);
        expect(topicMetadata(big).robots).toBeUndefined();
        expect(topicMetadata(big).alternates?.canonical).toBe(`${siteConfig.url}/spots/area/overseas/fr`);
    });

    it("国の頁のパンくずは 海外 → 国", () => {
        const { breadcrumb } = topicStructuredData(countryView("fr")!);
        expect(breadcrumb.itemListElement.map((x) => x.name)).toEqual(["ホーム", "撮影スポット", "海外", "フランスの撮影スポット"]);
    });
});

describe("季節", () => {
    const seasons = seasonTopics();

    it("載るのはその季節の案内を持つスポットだけ・地方別は MIN_TOPIC_SPOTS 件以上", () => {
        expect(seasons.filter((t) => t.area === null).map((t) => t.season)).toEqual([...SEASONS]);
        for (const t of seasons) {
            for (const s of t.spots) expect(s.seasonalGuide?.some((g) => g.season === t.season), `${seasonPath(t)} ${s.slug}`).toBe(true);
            if (t.area) expect(t.spots.length).toBeGreaterThanOrEqual(MIN_TOPIC_SPOTS);
        }
        expect(seasons.map(seasonPath)).toContain("/spots/season/autumn/kinki");
    });

    it("季節の案内の無い行は、どの季節の頁にも載らない", () => {
        const none = clone(kyotoBase, { seasonalGuide: undefined });
        const one = clone(kyotoBase, { seasonalGuide: [{ season: "winter", text: "雪" }] });
        const got = seasonTopics([none, one]);
        expect(got.map((t) => [t.season, t.spots.map((s) => s.slug)])).toEqual([["winter", [one.slug]]]);
    });

    it("🔴 全体の頁は並べる数を絞る（600KB に戻さない）が、どの行もどこかの季節の頁に載る", () => {
        for (const season of SEASONS) {
            const top = seasonView(season, null)!;
            const all = seasons.find((t) => t.season === season && t.area === null)!;
            const subs = seasons.filter((t) => t.season === season && t.area !== null);
            const onSub = new Set(subs.flatMap((t) => t.spots.map((s) => s.slug)));
            const orphans = all.spots.filter((s) => !onSub.has(s.slug)).length;
            expect(top.cards.length, season).toBeLessThanOrEqual(Math.max(SEASON_TOP_CARDS, orphans));
            const reachable = new Set([...onSub, ...top.cards.map((c) => c.slug)]);
            expect(all.spots.filter((s) => !reachable.has(s.slug)).map((s) => s.slug), season).toEqual([]);
            if (all.spots.length > top.cards.length) expect(top.intro).toContain(`${all.spots.length}件あります`);
        }
    });

    it("秋の導入文は「紅葉」の記述の件数を数える（題には使わない）", () => {
        const v = seasonView("autumn", "kinki")!;
        expect(v.heading).toBe("近畿地方（関西）の秋の撮影スポット");
        expect(v.intro).toMatch(/うち\d+件は秋の案内に「紅葉」の記述があります/);
        expect(v.crumbs).toEqual([{ name: "秋の撮影スポット", href: "/spots/season/autumn" }]);
    });
});

describe("並べ方・構造化データ", () => {
    it("代表写真のあるカードが先・ItemList は画面と同じ順と URL", () => {
        const v = themeView("temples-shrines", "kinki")!;
        const firstNoCover = v.cards.findIndex((c) => !c.cover);
        if (firstNoCover >= 0) expect(v.cards.slice(firstNoCover).every((c) => !c.cover)).toBe(true);
        expect(v.cards.some((c) => c.cover)).toBe(true);
        const { itemList } = topicStructuredData(v);
        expect(itemList?.itemListElement.map((x) => x.url)).toEqual(v.cards.map((c) => `${siteConfig.url}/spots/${c.slug}`));
    });

    it("CC BY 系の写真は作者とライセンスの文字を持つ", () => {
        const withCredit = themeView("temples-shrines", "kinki")!.cards.filter((c) => c.cover?.credit);
        expect(withCredit.length).toBeGreaterThan(0);
        for (const c of withCredit) expect(c.cover!.credit).toMatch(/CC|Public|PD/i);
    });
});

describe("内部リンク（スポットの頁 → 切り口）", () => {
    it("リンク先の頁は、そのスポットを本当に載せている", () => {
        const sample = shown.filter((_, i) => i % 37 === 0);
        let total = 0;
        for (const spot of sample) {
            for (const l of topicLinksForSpot(spot)) {
                total++;
                const m = /^\/spots\/(?:area\/overseas\/([a-z]+)|theme\/([a-z0-9-]+)\/([a-z0-9-]+)|season\/([a-z]+)(?:\/([a-z0-9-]+))?)$/.exec(l.href);
                expect(m, l.href).toBeTruthy();
                const view = m![1] ? countryView(m![1]) : m![2] ? themeView(m![2], m![3]) : seasonView(m![4], m![5] ?? null);
                expect(view?.cards.map((c) => c.slug), `${spot.slug} → ${l.href}`).toContain(spot.slug);
            }
        }
        expect(total).toBeGreaterThan(20);
    });

    it("京都府の寺社のスポットは県と地方のテーマへ、海外の行は国へ張る", () => {
        const kyotoTemple = shown.find((s) => s.category === "寺社" && s.region?.prefecture === "京都府")!;
        const hrefs = topicLinksForSpot(kyotoTemple).map((l) => l.href);
        expect(hrefs).toEqual(expect.arrayContaining(["/spots/theme/temples-shrines/kyoto", "/spots/theme/temples-shrines/kinki"]));
        const fr = shown.find((s) => s.region?.country === "フランス")!;
        expect(topicLinksForSpot(fr)[0]).toMatchObject({ href: "/spots/area/overseas/fr", label: "フランスの撮影スポット" });
    });

    it("公開済みでない行には張らない", () => {
        const draft = { ...kyotoBase, status: "review" as const, verifiedBy: undefined, aiCheck: undefined };
        expect(topicLinksForSpot(draft, [draft])).toEqual([]);
    });
});

describe("`/spots` の入口・サイトマップ", () => {
    it("季節4つとテーマの全部へのリンクを持つ", () => {
        const { seasons, themes } = spotIndexTopics();
        expect(seasons.map((l) => l.href)).toEqual(SEASONS.map((s) => `/spots/season/${s}`));
        expect(themes.flatMap((g) => g.links).length).toBe(themeTopics().length);
    });

    it("サイトマップは国（2件以上）・テーマ・季節を全部持ち、日付はビルドの時刻ではなくスポットの更新日", () => {
        const entries = spotTopicSitemapEntries("https://x.test");
        const urls = entries.map((e) => e.url);
        expect(new Set(urls).size).toBe(urls.length);
        expect(urls).toContain("https://x.test/spots/theme/temples-shrines/kyoto");
        expect(urls).toContain("https://x.test/spots/season/autumn/kinki");
        expect(urls).toContain("https://x.test/spots/area/overseas/fr");
        expect(entries.length).toBe(
            countryTopics().filter((c) => c.spots.length >= MIN_INDEXABLE_COUNTRY).length + themeTopics().length + seasonTopics().length);
        const fr = entries.find((e) => e.url.endsWith("/overseas/fr"))!;
        const latest = countryTopics().find((c) => c.code === "fr")!.spots.map((s) => s.updatedAt).sort().pop();
        expect(fr.lastModified).toBe(latest);
    });

    it("`app/sitemap.ts` が切り口の頁を載せている", async () => {
        const sitemap = (await import("../../../app/sitemap")).default;
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${siteConfig.url}/spots/theme/temples-shrines/kyoto`);
        expect(urls).toContain(`${siteConfig.url}/spots/season/spring`);
    }, 30_000); // サイトマップは写真・台帳を全部読む（`mapMetadata.test.ts` は develop でも5秒前後）
});

describe("ホーム: いまの季節の撮影スポット", () => {
    it("月で季節が決まる（日本時間）", () => {
        expect([1, 2, 3, 5, 6, 8, 9, 11, 12].map(seasonOfMonth)).toEqual(
            ["winter", "winter", "spring", "spring", "summer", "summer", "autumn", "autumn", "winter"]);
        // 9/30 15:00 UTC は日本の 10/1 0:00＝秋。8/31 14:59 UTC は日本の 8/31＝夏
        expect(homeSeasonalSpots(new Date("2026-08-31T14:59:00Z"))?.season).toBe("summer");
        expect(homeSeasonalSpots(new Date("2026-11-30T15:00:00Z"))?.season).toBe("winter");
    });

    it("その季節の案内と代表写真がある行だけ・南半球は外す・同じ月なら同じ顔ぶれ", () => {
        const now = new Date("2026-10-11T00:00:00Z");
        const h = homeSeasonalSpots(now)!;
        expect(h.season).toBe("autumn");
        expect(h.href).toBe("/spots/season/autumn");
        expect(h.spots.length).toBe(6);
        for (const x of h.spots) {
            const s = shown.find((y) => y.slug === x.slug)!;
            expect(s.seasonalGuide?.some((g) => g.season === "autumn")).toBe(true);
            expect(x.src).toMatch(/^\/images\/spots\//);
            expect(s.coords?.lat ?? 1).toBeGreaterThan(0);
        }
        expect(homeSeasonalSpots(new Date("2026-10-30T00:00:00Z"))!.spots).toEqual(h.spots);
        // 南半球の行は、秋の案内と写真があっても出ない
        const withPhoto = shown.find((s) => h.spots[0].slug === s.slug)!;
        const south = clone(withPhoto, { coords: { lat: -33.9, lng: 151.2 }, slug: withPhoto.slug });
        expect(homeSeasonalSpots(now, [south])).toBeNull();
    });

    it("渡すのは名前・場所・写真の場所だけ（台帳の本文を積まない）", () => {
        const h = homeSeasonalSpots(new Date("2026-10-11T00:00:00Z"))!;
        for (const x of h.spots) expect(Object.keys(x).sort()).toEqual(["alt", "credit", "name", "region", "slug", "src"]);
        expect(JSON.stringify(h).length).toBeLessThan(3000);
    });
});

describe("区画（`/spots/area/<x>`）との関係", () => {
    it("海外の区画の綴りは国の頁の親", () => {
        expect(countryView("fr")!.path.startsWith(`/spots/area/${OVERSEAS_SLUG}/`)).toBe(true);
    });

    it("全体の頁の数（報告に使う）が台帳の伸びに比べて大きくなりすぎない", () => {
        const pages = countryTopics().length + themeTopics().length + seasonTopics().length;
        // 2026-10-11: 国54・テーマ117・季節36＝207枚（スポットの頁は約1,800枚）
        expect(pages).toBeLessThan(shown.length / 4);
    });
});

void SPOTS;
