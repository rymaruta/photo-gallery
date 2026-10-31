import type { Metadata } from "next";
import SpotAreaIndexClient from "@/app/components/SpotAreaIndexClient";
import { SPOTS } from "@/lib/data/spots";
import { spotAreas } from "@/lib/data/spotLink";
import { visibleSpots, publishableSpots } from "@/lib/utils/spotGuide";
import { siteConfig, pageRobots, shareOgImage } from "@/lib/utils/seo";
import { spotAreaItemList } from "@/lib/data/spotSeo";
import { spotCheckedClaim } from "@/lib/data/spotPageMeta";
import { spotIndexTopics, firstSpotOgImage, spotTwitterMeta } from "@/lib/data/spotTopics";
import { TopicChips, Lang } from "@/app/components/SpotTopicLists";
import SectionHead, { SectionTitle } from "@/app/components/SectionHead";

/**
 * **撮影地ガイドの入口。**
 *
 * `/location`（写真から作る撮影地の索引）とは別の面。あちらは維持する。
 *
 * **人が確かめたスポットが少ないうちは索引に載せない**——名前が数個並ぶだけの
 * ページを検索に出しても、見た人の役に立たない（`/location` の索引が
 * `isIndexableCollectionIndex` で同じ判断をしている）。**下書き（review）は
 * 件数に数えない**——運営未確認の一覧を検索の着地点にしない。
 */
const MIN_INDEXABLE_SPOTS = 3;

export async function generateMetadata(): Promise<Metadata> {
    const n = visibleSpots(SPOTS).length;
    const verified = publishableSpots(SPOTS).length;
    const areas = spotAreas().length;
    const title = "撮影スポットをさがす";
    const og = firstSpotOgImage(publishableSpots(SPOTS), title);
    // 件数に「運営が調べた」と読める形で数えるのは、人が確かめた行だけ
    const description = n > 0
        ? (verified >= MIN_INDEXABLE_SPOTS
            ? `写真を撮りに行ける場所のガイド（${areas}地域・${verified}件${n > verified ? `・ほかに下書き${n - verified}件` : ""}）。見どころと、月ごとの日の出・日の入りなど撮影の光まで。${spotCheckedClaim(visibleSpots(SPOTS))}`
            : `写真を撮りに行ける場所のガイドの下書き（${areas}地域・${n}件）。運営がまだ確認していない情報を含みます。`)
        : "写真を撮りに行ける場所のガイド。";
    return {
        title,
        description,
        alternates: { canonical: `${siteConfig.url}/spots` },
        robots: pageRobots(verified >= MIN_INDEXABLE_SPOTS),
        openGraph: {
            type: "website", url: `${siteConfig.url}/spots`, siteName: siteConfig.name, title, description,
            // 子の `openGraph` は親（レイアウト）の画像ごと置き換えるので、ここで渡す（2026-10-16・絵が無かった）
            // 写真が無ければサイトの固定の代表画像（2026-10-31 #432）
            images: [og ?? shareOgImage()],
        },
        // og:image と同じ1枚（レイアウトの新着写真を残さない・2026-10-22）
        twitter: spotTwitterMeta(title, description, og?.url),
    };
}

export default function SpotIndexPage() {
    // 🔴 **スポットそのものを渡さない。** クライアント部品への props は HTML に
    // 埋め込まれるので、渡したぶんが訪問のたびに落ちる。ここが渡すのは
    // **県の名前と件数だけ**で、47県でも3KBに満たない
    // （実測は `lib/data/spotLink.ts` の `SpotArea` の注記）
    const total = visibleSpots(SPOTS).length;
    const areas = spotAreas();
    return (
        <>
            {/* **一覧の構造化データ（ItemList）。** 画面に並べている地域のリンク
                （`/spots/area/<slug>`）と同じものを同じ順で渡す——画面に無いもの
                （個々のスポット）は載せない。0件なら出さない */}
            {areas.length > 0 && (
                <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(spotAreaItemList(areas)) }} />
            )}
            <SpotAreaIndexClient areas={areas} total={total} draftCount={total - publishableSpots(SPOTS).length}>
                <SpotIndexTopicSections />
            </SpotAreaIndexClient>
        </>
    );
}

/** JSON-LD を `<script>` に埋める形（`SpotGuidePage.tsx` と同じ。`</script>` で閉じられないように） */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");


/**
 * **季節・テーマの切り口への入口**（2026-10-11）。県の一覧の下に置く。
 * 海外の国は「海外」の区画（`/spots/area/overseas`＝国の一覧）から辿る。
 * サーバーで描くので、切り口の一覧はクライアントの props に乗らない（HTML の本文だけ）
 */
function SpotIndexTopicSections() {
    const { seasons, themes } = spotIndexTopics();
    if (seasons.length === 0 && themes.length === 0) return null;
    return (
        <div data-testid="spots-topic-index">
            {seasons.length > 0 && (
                <section className="mb-7">
                    <SectionHead id="spots-by-season" eyebrow="SEASON" title={<Lang ja="季節でさがす" en="By season" />} />
                    <TopicChips links={seasons} />
                </section>
            )}
            {themes.length > 0 && (
                <section className="mb-7">
                    <SectionHead id="spots-by-theme" eyebrow="THEME" title={<Lang ja="テーマでさがす" en="By theme" />} />
                    {themes.map((g) => (
                        <div key={g.category} className="mb-3">
                            <SectionTitle as="h3"><Lang ja={g.category} en={g.categoryEn} /></SectionTitle>
                            <TopicChips links={g.links} />
                        </div>
                    ))}
                </section>
            )}
        </div>
    );
}
