import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sitemap from "../sitemap";
import { siteConfig } from "../../lib/utils/seo";
import {
    collectEntries,
    collectionIndexPath,
    isIndexableCollectionIndex,
    type CollectionType,
} from "../../lib/utils/collections";
import type { Photo } from "../../lib/data/photos";

/**
 * 🔴 **索引ページ**（`/category` `/location` `/camera`）**をサイトマップに載せる。**
 *
 * 載せないと、**ページは生成されるのにサイトマップに1行も出ない**
 * ——この台帳が何度も記録している「関数は書いたが配線していない」の形で、
 * 画面には何の症状も出ない。
 *
 * ⚠️ **`sitemapCamera.test.ts` は綴りで見る**（`as CollectionType[]` の列挙）。
 * こちらは**実際に `sitemap()` を呼んで出た URL** を見る——列挙を足しても
 * `return [...]` に混ぜ忘れれば綴りの側は緑のままなので、両方要る
 * （実際、最初に書いたとき `indexUrls` を返り値に入れ忘れていた）。
 */
const TYPES: CollectionType[] = ["location", "category", "camera"];

function realPhotos(): Photo[] {
    const p = join(process.cwd(), "app", "data", "photos.json");
    const raw = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Photo[]) : [];
    return raw.filter((x) => x.published !== false);
}

describe("サイトマップ: 索引ページ", () => {
    it("載せる線を超えている種別は、全部 URL が出ている", async () => {
        const photos = realPhotos();
        const urls = new Set((await sitemap()).map((e) => e.url));
        const wanted = TYPES.filter((t) => isIndexableCollectionIndex(collectEntries(photos, t).length));
        // **空回りの検出。** 実データで1つも線を超えていなければ、
        // 下のループは何も確かめずに緑になる
        expect(wanted.length, "実データでは索引ページが1つも載らない（判定が空回りしている）")
            .toBeGreaterThan(0);
        for (const t of wanted) {
            expect(urls, `${collectionIndexPath(t)} が出ていない`)
                .toContain(`${siteConfig.url}${collectionIndexPath(t)}`);
        }
    });

    it("線に届かない種別は載せない（薄い索引を申告しない）", async () => {
        const photos = realPhotos();
        const urls = new Set((await sitemap()).map((e) => e.url));
        for (const t of TYPES) {
            if (isIndexableCollectionIndex(collectEntries(photos, t).length)) continue;
            expect(urls, `${collectionIndexPath(t)} を載せている`)
                .not.toContain(`${siteConfig.url}${collectionIndexPath(t)}`);
        }
    });

    // **個別ページの URL と食い違わせない。** `/category` と `/category/<slug>` は
    // 別物で、索引だけ出して個別を落とす（またはその逆）と回遊が切れる
    it("索引と個別の両方が出ている", async () => {
        const entries = (await sitemap()).map((e) => e.url);
        const hasIndex = entries.includes(`${siteConfig.url}/category`);
        const hasChild = entries.some((u) => u.startsWith(`${siteConfig.url}/category/`));
        expect(hasIndex, "索引が無い").toBe(true);
        expect(hasChild, "個別ページが無い（実データが変わった？）").toBe(true);
    });
});
