import type { Metadata } from "next";
import SpotIndexClient from "@/app/components/SpotIndexClient";
import { spotAreas, spotIndexItemsForArea } from "@/lib/data/spotLink";
import { withPlaceholderParam } from "@/lib/server/staticParams";
import { siteConfig } from "@/lib/utils/seo";

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
    const found = spotAreas().find((a) => a.slug === area);
    if (!found) return { robots: { index: false, follow: true } };

    const title = `${found.name}の撮影スポット${found.count}選`;
    const description =
        `${found.name}で写真を撮りに行ける場所のガイド（${found.count}件）。`
        + "見どころ・季節・時間帯・アクセスまで、運営が調べてまとめています。";
    const url = `${siteConfig.url}/spots/area/${found.slug}`;
    return {
        title,
        description,
        alternates: { canonical: url },
        robots: found.count >= MIN_INDEXABLE_AREA ? undefined : { index: false, follow: true },
        openGraph: {
            type: "website", url, siteName: siteConfig.name,
            locale: siteConfig.locale.ja, title, description,
        },
    };
}

export default async function SpotAreaPage({ params }: { params: Promise<{ area: string }> }) {
    const { area } = await params;
    const found = spotAreas().find((a) => a.slug === area);
    return (
        <SpotIndexClient
            spots={spotIndexItemsForArea(area)}
            area={found ? { name: found.name, nameEn: found.nameEn } : undefined}
        />
    );
}
