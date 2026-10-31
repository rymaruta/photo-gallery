import type { Metadata } from "next";
import SpotIndexClient from "@/app/components/SpotIndexClient";
import { spotAreas, spotIndexItemsForArea, visibleSpotsInArea } from "@/lib/data/spotLink";
import { spotCheckedClaim } from "@/lib/data/spotPageMeta";
import { withPlaceholderParam } from "@/lib/server/staticParams";
import { siteConfig, pageRobots, shareOgImage } from "@/lib/utils/seo";
import SpotTopicPage from "@/app/components/SpotTopicPage";
import { overseasView, topicMetadata, areaStructuredData, spotTwitterMeta } from "@/lib/data/spotTopics";
import { OVERSEAS_SLUG } from "@/lib/data/prefectures";

/** JSON-LD を `<script>` に埋める形（`SpotTopicPage.tsx` と同じ。`</script>` で閉じられないように） */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

// 静的エクスポート: 列挙した区画のみ生成し、それ以外は 404
export const dynamicParams = false;

/**
 * **都道府県ごとの撮影スポット一覧。**
 *
 * 🔴 `/spots` に全件を並べると、台帳が伸びたぶんだけ索引が重くなる
 * （実測は `lib/data/spotLink.ts` の `SpotArea` の注記）。HTML は
 * `no-cache, no-store` で配るので、**訪問のたびに落ちるバイト**になる。
 * だから `/spots` は県の一覧にし、スポットはこのページに分ける。
 *
 * **公開できるスポットが1件も無い県のページは作らない**（`spotAreas` が
 * 0件の県を返さない）——押しても何も無いリンクを作らないのと同じ理由。
 *
 * ⚠️ `/spots/area/<x>` は `/spots/<slug>` と**同じ親の下**にある。
 * `area` という `slug` のスポットを台帳に入れると
 * `out/spots/area.html` がディレクトリとぶつかる。見張りは
 * `lib/data/__tests__/spotsLedger.test.ts` の予約スラッグの項。
 */
export function generateStaticParams() {
    const areas = spotAreas().map((a) => ({ area: a.slug }));
    // 0件だと `output: export` がビルドを落とすので、1件は返す
    return withPlaceholderParam(areas, "area");
}

/**
 * **1件しか無い県は検索に出さない。** そのページは中身がスポット1件の
 * 紹介と同じになり、個別ページ（固有の本文を持つ側）と食い合う。
 * `CLAUDE.md` の撮影地の線（`MIN_INDEXABLE_LOCATION` ＝ 2枚）と同じ考え方。
 */
const MIN_INDEXABLE_AREA = 2;

export async function generateMetadata({ params }: { params: Promise<{ area: string }> }): Promise<Metadata> {
    const { area } = await params;
    // 海外は国の一覧の頁になった（2026-10-11）ので、題・説明・OGP も国の一覧の中身から作る
    // （「海外の撮影スポット814選」と名乗ると、スポットの並ばない頁と食い違う）
    if (area === OVERSEAS_SLUG) return topicMetadata(overseasView());
    const found = spotAreas().find((a) => a.slug === area);
    if (!found) return { robots: { index: false, follow: true } };

    // **人が確かめた件数で検索に出すかを決める。** 下書きしか無い県のページは
    // 建てるが `noindex`。題も「N選」と名乗らない（運営が調べたと読める）
    const indexable = found.publishedCount >= MIN_INDEXABLE_AREA;
    const drafts = found.count - found.publishedCount;
    // **「検索に出すか」と「下書きと名乗るか」は別の条件。** 確かめた1件だけの県は
    // noindex だが下書きではない——同じ条件で分けると「（下書き・1件）」と嘘を名乗る
    // （下書きを建てなくなった 2026-09-25 に、公開済み4県が全部これになった）
    // 「N選」「運営が調べた」に数えるのは**人が確かめた件数だけ**。下書きは別に数える
    const title = indexable
        ? `${found.name}の撮影スポット${found.publishedCount}選`
        : drafts === 0
            ? `${found.name}の撮影スポット（${found.publishedCount}件）`
            : `${found.name}の撮影スポット（下書き・${found.count}件）`;
    const description = indexable || drafts === 0
        ? `${found.name}で写真を撮りに行ける場所のガイド（${found.publishedCount}件${drafts > 0 ? `・ほかに下書き${drafts}件` : ""}）。`
            // 2026-10-11: 「アクセスまで、運営が調べて」は実態と違った（アクセスは出典つきで数件・
            // 人が確かめたのは数件で多くは AI 照合）。在るもの（見どころ・撮影の光）と確かめ方を書く
            + "見どころと、月ごとの日の出・日の入りなど撮影の光をまとめています。"
            // 🔴 行ごとに `spotAreaOf` で絞らない——1行ごとに台帳全体の見える判定をやり直し、
            // 1ページ約9秒・build で 60 秒超えになった（2026-10-15・`visibleSpotsInArea` の注記）
            + spotCheckedClaim(visibleSpotsInArea(found.slug))
        : `${found.name}で写真を撮りに行ける場所のガイドの下書き（${found.count}件）。`
            + "運営がまだ確認していない情報を含みます。";
    const url = `${siteConfig.url}/spots/area/${found.slug}`;
    // 代表写真（2026-10-16）。共有したときに県の頁だけ絵が無かった
    const { ogImage } = areaStructuredData(found, visibleSpotsInArea(found.slug));
    return {
        title,
        description,
        alternates: { canonical: url },
        robots: pageRobots(indexable),
        openGraph: {
            type: "website", url, siteName: siteConfig.name,
            locale: siteConfig.locale.ja, title, description,
            // 写真が無ければサイトの固定の代表画像（2026-10-31 #432）
            images: [ogImage ?? shareOgImage()],
        },
        // og:image と同じ1枚（レイアウトの新着写真を残さない・2026-10-22）
        twitter: spotTwitterMeta(title, description, ogImage?.url),
    };
}

export default async function SpotAreaPage({ params }: { params: Promise<{ area: string }> }) {
    const { area } = await params;
    // 🔴 **海外は国の一覧にする**（2026-10-11）。814件を1頁に並べると約1.3MB で、HTML は
    // 訪問のたびに落ちる。スポットは国の頁（`/spots/area/overseas/<国>`）に分けた。URL はそのまま
    if (area === OVERSEAS_SLUG) return <SpotTopicPage view={overseasView()} eyebrow="Photo spots · Outside Japan" />;
    const found = spotAreas().find((a) => a.slug === area);
    // パンくずと並べたスポットの `ItemList`（2026-10-16・切り口の頁と同じ形。県の頁だけ無かった）
    const ld = found ? areaStructuredData(found, visibleSpotsInArea(found.slug)) : null;
    return (
        <>
            {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld.breadcrumb) }} />}
            {ld?.itemList && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld.itemList) }} />}
            <SpotIndexClient
                spots={spotIndexItemsForArea(area)}
                area={found ? { name: found.name, nameEn: found.nameEn } : undefined}
            />
        </>
    );
}
