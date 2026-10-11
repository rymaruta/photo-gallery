import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SpotTopicPage from "@/app/components/SpotTopicPage";
import { themeTopics, themeView, topicMetadata } from "@/lib/data/spotTopics";
import { EMPTY_PARAM_PLACEHOLDER } from "@/lib/server/staticParams";

// 静的エクスポート: 列挙した組のみ生成し、それ以外は 404
export const dynamicParams = false;

/**
 * **テーマ（カテゴリ × 地域）の撮影スポット一覧**（`/spots/theme/<カテゴリ>/<地域>`・2026-10-11）。
 *
 * 「京都府の寺社の撮影スポット」「フランスの教会の撮影スポット」のような検索語の着地点。
 * 地域は県・地方（日本）・国（海外）。**`MIN_TOPIC_SPOTS` 件以上の組だけ**作る
 * （薄い頁を量産しない・`lib/data/spotTopics.ts`）。
 *
 * ⚠️ `/spots/theme` は `/spots/<slug>` と同じ親の下。`theme` という slug のスポットは
 * 台帳に入れられない（見張りは `spotsLedger.test.ts` の予約スラッグの項）。
 */
export function generateStaticParams() {
    const params = themeTopics().map((t) => ({ category: t.categorySlug, place: t.place.slug }));
    return params.length > 0 ? params : [{ category: EMPTY_PARAM_PLACEHOLDER, place: EMPTY_PARAM_PLACEHOLDER }];
}

export async function generateMetadata({ params }: { params: Promise<{ category: string; place: string }> }): Promise<Metadata> {
    const { category, place } = await params;
    return topicMetadata(themeView(category, place));
}

export default async function SpotThemePage({ params }: { params: Promise<{ category: string; place: string }> }) {
    const { category, place } = await params;
    const view = themeView(category, place);
    if (!view) notFound();
    return <SpotTopicPage view={view} eyebrow="Photo spots · Theme" />;
}
