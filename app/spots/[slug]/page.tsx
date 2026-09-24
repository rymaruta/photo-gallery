import type { Metadata } from "next";
import SpotGuidePage from "@/app/components/SpotGuidePage";
import { SPOTS } from "@/lib/data/spots";
import { publishableSpots } from "@/lib/utils/spotGuide";
import { withPlaceholderParam } from "@/lib/server/staticParams";
import { siteConfig } from "@/lib/utils/seo";

// 静的エクスポート: 列挙した slug のみ生成し、それ以外は 404
export const dynamicParams = false;

/**
 * **写真ではなく台帳から作る。** ここが `/location/*` との違いで、
 * 投稿が0枚のスポットでもページが生まれる理由。
 *
 * **公開の条件を満たすものだけ**（`publishableSpots`）——名称と地図しか
 * 無い薄いページを大量に作らない（owner の指示書 第15章）。
 */
export function generateStaticParams() {
    const slugs = publishableSpots(SPOTS).map((s) => ({ slug: s.slug }));
    // 0件だと `output: export` がビルドを落とすので、1件は返す
    return withPlaceholderParam(slugs, "slug");
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const spot = publishableSpots(SPOTS).find((s) => s.slug === slug);
    if (!spot) return { robots: { index: false, follow: true } };

    const where = [spot.region?.prefecture, spot.region?.city].filter(Boolean).join(" ");
    const title = where ? `${spot.name}（${where}）の撮影ガイド` : `${spot.name} の撮影ガイド`;
    const description = spot.summary ?? `${spot.name}で写真を撮るための情報。`;
    const url = `${siteConfig.url}/spots/${spot.slug}`;
    // **代表写真があるときだけ OGP に出す。** 無ければ画像を申告しない
    const image = spot.coverImage?.src
        ? (spot.coverImage.src.startsWith("http") ? spot.coverImage.src : `${siteConfig.url}${spot.coverImage.src}`)
        : undefined;

    return {
        title,
        description,
        alternates: { canonical: url },
        openGraph: {
            type: "article",
            locale: siteConfig.locale.ja,
            url,
            siteName: siteConfig.name,
            title,
            description,
            images: image ? [{ url: image }] : undefined,
        },
        twitter: {
            card: image ? "summary_large_image" : "summary",
            title,
            description,
            images: image ? [image] : undefined,
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
