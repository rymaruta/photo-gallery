import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SpotTopicPage from "@/app/components/SpotTopicPage";
import { seasonTopics, seasonView, topicMetadata } from "@/lib/data/spotTopics";
import { EMPTY_PARAM_PLACEHOLDER } from "@/lib/server/staticParams";

// 静的エクスポート: 列挙した組のみ生成し、それ以外は 404
export const dynamicParams = false;

/**
 * **季節の撮影スポットの地方別**（`/spots/season/<季節>/<地方|overseas>`・2026-10-11）。
 * **`MIN_TOPIC_SPOTS` 件以上の地方だけ**（`lib/data/spotTopics.ts`）。
 */
export function generateStaticParams() {
    const params = seasonTopics().filter((t) => t.area !== null).map((t) => ({ season: t.season as string, region: t.area as string }));
    return params.length > 0 ? params : [{ season: "spring", region: EMPTY_PARAM_PLACEHOLDER }];
}

export async function generateMetadata({ params }: { params: Promise<{ season: string; region: string }> }): Promise<Metadata> {
    const { season, region } = await params;
    return topicMetadata(seasonView(season, region));
}

export default async function SpotSeasonRegionPage({ params }: { params: Promise<{ season: string; region: string }> }) {
    const { season, region } = await params;
    const view = seasonView(season, region);
    if (!view) notFound();
    return <SpotTopicPage view={view} eyebrow="Photo spots · Season" />;
}
