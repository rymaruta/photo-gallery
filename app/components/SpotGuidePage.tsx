// app/components/SpotGuidePage.tsx（サーバーコンポーネント）
//
// **公式撮影地ガイド `/spots/<slug>` の本体。**
//
// 🔴 **ここが `/location/*` と決定的に違う点**:
//
//     /location/<スラッグ>   写真が0枚だと `notFound()`（ページごと存在しない）
//     /spots/<slug>          **台帳に在れば存在する**。写真は0枚でよい
//
// owner:「ユーザーの投稿が0枚でも、その撮影地について十分な情報を得られ、
// 実際に行って撮影したくなるページ」。**写真の枚数を完成条件にしない。**

import { notFound } from "next/navigation";
import SpotGuideClient from "./SpotGuideClient";
import { spotCoverImage } from "@/lib/data/spotImages";
import { loadAllPhotos } from "@/lib/server/photos";
import { SPOTS } from "@/lib/data/spots";
import { visibleSpots, isPublished } from "@/lib/utils/spotGuide";
import { slimForGrid } from "@/lib/utils/related";
import { collectionPath, slugify } from "@/lib/utils/collections";
import { spotAreaOf } from "@/lib/data/spotLink";
import { spotBreadcrumb, spotStructuredData, sameAreaSpots, sameAreaLabel, spotPageUrl } from "@/lib/data/spotSeo";
import { generateBreadcrumbStructuredData, siteConfig } from "@/lib/utils/seo";
import { haversineKm } from "@/lib/utils/journey";

/** JSON-LD を `<script>` に埋める形（`SpotPage.tsx` と同じ。`</script>` で閉じられないように） */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

/**
 * そのスポットの写真。**`spotId` が確認済みで付いているものだけ。**
 *
 * owner:「写真の `location` 文字列が似ているだけで、未確認のスポットへ
 * 紐付けないでください」。だから**文字列の一致では拾わない**——
 * `spotId` は人が確認したものしか入らない（`lib/utils/spots.ts` の `linkStates`）。
 */
function photosForSpot(photos: Awaited<ReturnType<typeof loadAllPhotos>>, spotId: string) {
    return photos.filter((p) => p.published !== false && p.spotId === spotId);
}

export default async function SpotGuidePage({ slug }: { slug: string }) {
    const spot = visibleSpots(SPOTS).find((s) => s.slug === slug);
    // **建てる条件を満たさないものはページを作らない**（`draft`・情報不足）。
    // `review`（運営未確認の下書き）は `BUILD_DRAFT_SPOTS` が true のときだけ建つ——帯と noindex はクライアント側と
    // `generateMetadata` が付ける
    if (!spot) notFound();

    const photos = await loadAllPhotos();
    const mine = photosForSpot(photos, spot.spotId);

    // 周辺スポット。**手で選んだものだけ**（座標が近い＝関係があるとは限らない）。
    // 座標で近い順に並べる節は別に「◯◯県の撮影スポット」として出す（`sameAreaSpots`・2026-09-29）
    const published = visibleSpots(SPOTS);
    const nearby = (spot.nearbySpotIds ?? [])
        .map((id) => published.find((s) => s.spotId === id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => ({
            slug: s.slug,
            name: s.name,
            region: [s.region?.prefecture, s.region?.city].filter(Boolean).join(" ") || undefined,
            ...(spot.coords && s.coords ? { km: haversineKm(spot.coords, s.coords) } : {}),
        }));

    /**
     * 同じ場所を指す集約ページ。**`/location/*` は維持**（役割が違う）。
     * 台帳の正式名が、写真に書かれた撮影地と同じ綴りなら道を出す
     * ——**無ければ出さない**（行った先が404になるリンクを置かない）。
     */
    const locSlug = slugify(spot.name, "location");
    const hasLocationPage = photos.some(
        (p) => p.published !== false && slugify(p.location ?? "", "location") === locSlug,
    );
    const locationPath = hasLocationPage ? collectionPath("location", locSlug) : null;

    // `draftedBy`（下書きを書いた主体）は台帳の中だけに持つ。props は RSC
    // ペイロードとして HTML に埋まるので、鍵ごと落とす（`undefined` を入れると
    // 鍵は `"$undefined"` として残る）
    const { draftedBy: _omitted, ...rest } = spot;
    void _omitted;
    // 代表写真。台帳に無ければ Commons の写真（サイト内に置いた縮小版）で埋める
    const cover = spotCoverImage(spot);
    const spotForClient = cover ? { ...rest, coverImage: cover } : rest;

    // 検索に読ませる形（観光地・パンくず）と、同じ県のほかのスポット
    const area = spotAreaOf(spot);
    const coverUrl = cover?.src
        ? (cover.src.startsWith("http") ? cover.src : `${siteConfig.url}${cover.src}`)
        : undefined;
    // 観光地の構造化データは**人が確かめた行だけ**（下書きを建てる設定のとき、noindex の
    // ページから「確かな場所」として読ませない）
    const placeData = isPublished(spot) ? spotStructuredData(spot, { image: coverUrl }) : null;
    const breadcrumbData = generateBreadcrumbStructuredData(spotBreadcrumb(spot, area));
    const sameArea = sameAreaSpots(spot);
    const sameAreaName = sameAreaLabel(spot, area);

    return (
        <>
            {placeData && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(placeData) }} />}
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbData) }} />
            <SpotGuideClient
                spot={spotForClient}
                photos={mine.map(slimForGrid)}
                nearby={nearby}
                locationPath={locationPath}
                area={area ? { slug: area.slug, name: area.name, nameEn: area.nameEn } : null}
                sameArea={sameArea.length > 0 && sameAreaName ? { label: sameAreaName, spots: sameArea } : null}
                pageUrl={spotPageUrl(spot)}
            />
        </>
    );
}
