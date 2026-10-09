import type { Metadata } from "next";
import SpotGuidePage from "@/app/components/SpotGuidePage";
import { SPOTS } from "@/lib/data/spots";
import { visibleSpots, isPublished } from "@/lib/utils/spotGuide";
import { withPlaceholderParam } from "@/lib/server/staticParams";
import { siteConfig } from "@/lib/utils/seo";
import { spotCoverImage } from "@/lib/data/spotImages";

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
    const where = [spot.region?.prefecture, spot.region?.city].filter(Boolean).join(" ");
    const title = where ? `${spot.name}（${where}）の撮影ガイド` : `${spot.name} の撮影ガイド`;
    // 下書きは説明文の頭でもそう名乗る（共有プレビューで「確認済み」に見せない）
    const description = (verified ? "" : "【下書き・運営未確認】")
        + (spot.summary ?? `${spot.name}で写真を撮るための情報。`);
    const url = `${siteConfig.url}/spots/${spot.slug}`;
    // 代表写真があればそれを OGP に出す。
    // **無ければサイトの既定の画像（`siteConfig.ogImage`）に落とす**——画像を申告しないと、
    // 共有したときに画像の無いプレビューになる。
    // 新着の写真（`resolveOgImage`）には落とさない: 別の場所の写真を、この場所の写真として
    // 見せることになる。既定の画像は正方形のアイコンなので、カードは小さい形（`summary`）
    const cover = spotCoverImage(spot);
    const photo = cover?.src
        ? (cover.src.startsWith("http") ? cover.src : `${siteConfig.url}${cover.src}`)
        : undefined;
    const image = photo ?? `${siteConfig.url}${siteConfig.ogImage}`;

    return {
        title,
        description,
        alternates: { canonical: url },
        // **下書きは検索に出さない**（リンクは辿らせる。確かめたら外れる）
        robots: verified ? undefined : { index: false, follow: true },
        openGraph: {
            type: "article",
            locale: siteConfig.locale.ja,
            url,
            siteName: siteConfig.name,
            title,
            description,
            images: [{ url: image, alt: photo ? spot.name : siteConfig.name }],
        },
        twitter: {
            card: photo ? "summary_large_image" : "summary",
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
