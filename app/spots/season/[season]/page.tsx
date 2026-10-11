import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SpotTopicPage from "@/app/components/SpotTopicPage";
import { seasonTopics, seasonView, topicMetadata } from "@/lib/data/spotTopics";
import { withPlaceholderParam } from "@/lib/server/staticParams";

// 静的エクスポート: 列挙した季節のみ生成し、それ以外は 404
export const dynamicParams = false;

/**
 * **季節の撮影スポット**（`/spots/season/<spring|summer|autumn|winter>`・2026-10-11）。
 *
 * 台帳の `seasonalGuide` にその季節の項目を持つスポットだけを集める（季節の案内が無い行は
 * 載せない＝「秋に良い」とデータが言っていない場所を秋の頁に出さない）。
 * 地方別は `/spots/season/<季節>/<地方>`。⚠️ `season` という slug のスポットは台帳に入れられない
 * （`spotsLedger.test.ts` の予約スラッグ）。
 */
export function generateStaticParams() {
    return withPlaceholderParam(seasonTopics().filter((t) => t.area === null).map((t) => ({ season: t.season as string })), "season");
}

export async function generateMetadata({ params }: { params: Promise<{ season: string }> }): Promise<Metadata> {
    const { season } = await params;
    return topicMetadata(seasonView(season, null));
}

export default async function SpotSeasonPage({ params }: { params: Promise<{ season: string }> }) {
    const { season } = await params;
    const view = seasonView(season, null);
    if (!view) notFound();
    return <SpotTopicPage view={view} eyebrow="Photo spots · Season" />;
}
