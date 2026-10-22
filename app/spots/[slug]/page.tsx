import type { Metadata } from "next";
import SpotGuidePage from "@/app/components/SpotGuidePage";
import { SPOTS } from "@/lib/data/spots";
import { visibleSpots, isPublished } from "@/lib/utils/spotGuide";
import { withPlaceholderParam } from "@/lib/server/staticParams";
import { siteConfig, pageRobots } from "@/lib/utils/seo";
import { spotCoverImage } from "@/lib/data/spotImages";
import { spotSamples, spotSeoImage } from "@/lib/data/spotSamples";
import { spotPageTitle, spotPageDescription } from "@/lib/data/spotPageMeta";
import { lightCalendar } from "@/lib/utils/lightCalendar";
import { spotSkyDescription } from "@/lib/utils/spotSky";

// 静的エクスポート: 列挙した slug のみ生成し、それ以外は 404
export const dynamicParams = false;

/**
 * **写真ではなく台帳から作る。** ここが `/location/*` との違いで、
 * 投稿が0枚のスポットでもページが生まれる理由。
 *
 * **建てる条件を満たすものだけ**（`visibleSpots`）——名称と地図しか
 * 無い薄いページを大量に作らない（owner の指示書 第15章）。
 *
 * 🔴 **運営未確認の下書き（`review`）は、建てる設定のときも検索には出さない。**
 * いまは建てない（`BUILD_DRAFT_SPOTS = false`・2026-09-25）。下の分岐はその設定に戻したときの描き方。
 * `noindex` ＋ サイトマップ外（`app/sitemap.ts` は `publishableSpots`）。
 * 人が確かめて `published` に上げた行だけが検索に載る。
 */
export function generateStaticParams() {
    const slugs = visibleSpots(SPOTS).map((s) => ({ slug: s.slug }));
    // 0件だと `output: export` がビルドを落とすので、1件は返す
    return withPlaceholderParam(slugs, "slug");
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const spot = visibleSpots(SPOTS).find((s) => s.slug === slug);
    if (!spot) return { robots: { index: false, follow: true } };

    const verified = isPublished(spot);
    // title・description は検索される語（〈名所〉 写真／撮影／撮影地）と押す理由（作例の数・撮影に向く季節）を頭に置く
    // （`lib/data/spotPageMeta.ts`・2026-10-22）。
    // 下書きは説明文の頭でもそう名乗る（共有プレビューで「確認済み」に見せない）
    const url = `${siteConfig.url}/spots/${spot.slug}`;
    // 代表写真があればそれを OGP に出す。
    // **無ければサイトの既定の画像（`siteConfig.ogImage`）に落とす**——画像を申告しないと、
    // 共有したときに画像の無いプレビューになる。
    // 新着の写真（`resolveOgImage`）には落とさない: 別の場所の写真を、この場所の写真として
    // 見せることになる。既定の画像は正方形のアイコンなので、カードは小さい形（`summary`）
    const cover = spotCoverImage(spot);
    // 数えるのは画面と同じもの（作例は代表写真と同じ1枚を除く・`SpotGuidePage`）
    const samples = spotSamples(spot, { exclude: [cover?.sourceUrl] });
    // 2026-10-22: OGP の1枚は**横 1,200px 以上を優先**（`spotSeoImage`）。代表写真の Commons の 1280px 版 →
    // 画面の作例の 1,200 以上 → 代表写真の 960px の順。幅・高さも申告する
    const seo = spotSeoImage(spot, samples);
    const image = seo?.url ?? `${siteConfig.url}${siteConfig.ogImage}`;
    const ogSize = seo?.width && seo?.height ? { width: seo.width, height: seo.height } : {};
    // 2026-10-22: title と description は同じ事実（作例の実数・光の表など）から組む
    const facts = {
        light: lightCalendar(spot.coords, spot.region?.country, spot.timeZone) !== null,
        samples: samples.length,
        // 画面に代表写真を出すか（OGP の1枚が作例でも、ここは画面の代表写真の有無）
        cover: Boolean(cover?.src),
        // 座標から計算した要約（日の入りの方角・天の川の月）。紹介文より前に置く（`spotSkyDescription`）
        computed: spotSkyDescription(spot),
    };
    const title = spotPageTitle(spot, facts);
    const description = spotPageDescription(spot, facts);

    return {
        // サイト全体の template（「 | Journey Photo 旅フォトギャラリー」）を外し、短い名前を自分で付ける
        title: { absolute: title },
        description,
        alternates: { canonical: url },
        // **下書きは検索に出さない**（リンクは辿らせる。確かめたら外れる）
        robots: pageRobots(verified),
        openGraph: {
            type: "article",
            locale: siteConfig.locale.ja,
            url,
            siteName: siteConfig.name,
            title,
            description,
            images: [{ url: image, ...ogSize, alt: seo ? spot.name : siteConfig.name }],
        },
        twitter: {
            card: seo ? "summary_large_image" : "summary",
            title,
            description,
            images: [image],
            creator: siteConfig.twitterHandle,
        },
    };
}

/**
 * **公式撮影地ガイド。**
 *
 * `/location/*`（地域・撮影地の集約）とは**別の面**で、あちらは維持する。
 * 一律のリダイレクトも削除もしない。
 */
export default async function SpotRoute({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    return <SpotGuidePage slug={slug} />;
}
