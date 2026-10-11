import type { Metadata } from "next";
import SpotTopicPage from "@/app/components/SpotTopicPage";
import { countryTopics, countryView, topicMetadata } from "@/lib/data/spotTopics";
import { OVERSEAS_SLUG } from "@/lib/data/prefectures";
import { EMPTY_PARAM_PLACEHOLDER } from "@/lib/server/staticParams";
import { notFound } from "next/navigation";

// 静的エクスポート: 列挙した国のみ生成し、それ以外は 404
export const dynamicParams = false;

/**
 * **海外の国ごとの撮影スポット一覧**（`/spots/area/overseas/<国の2文字>`・2026-10-11）。
 *
 * それまで海外は `/spots/area/overseas` の1頁に814件（約1.3MB）を並べていた。
 * HTML は `no-cache, no-store` で配る（`scripts/deploy-static-site.js`）ので、訪問のたびに
 * 落ちる重さだった。`/spots/area/overseas` は国の一覧（件数つき）にし、スポットはここに分ける。
 *
 * 区画（`[area]`）は海外だけ。県（`/spots/area/kyoto`）の下には作らない。
 * 1件の国も頁は建てる（国の一覧から行き止まりにしない）が `noindex`（`MIN_INDEXABLE_COUNTRY`）。
 */
export function generateStaticParams() {
    const params = countryTopics().map((c) => ({ area: OVERSEAS_SLUG, country: c.code }));
    // 0件だと `output: export` がビルドを落とすので、1件は返す（`withPlaceholderParam` と同じ）
    return params.length > 0 ? params : [{ area: OVERSEAS_SLUG, country: EMPTY_PARAM_PLACEHOLDER }];
}

export async function generateMetadata({ params }: { params: Promise<{ area: string; country: string }> }): Promise<Metadata> {
    const { area, country } = await params;
    return topicMetadata(area === OVERSEAS_SLUG ? countryView(country) : null);
}

export default async function SpotCountryPage({ params }: { params: Promise<{ area: string; country: string }> }) {
    const { area, country } = await params;
    const view = area === OVERSEAS_SLUG ? countryView(country) : null;
    if (!view) notFound();
    return <SpotTopicPage view={view} eyebrow="Photo spots · Country" />;
}
