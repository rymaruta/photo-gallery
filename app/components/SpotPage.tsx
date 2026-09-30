// app/components/SpotPage.tsx（サーバーコンポーネント）
//
// **撮影スポット詳細。`/location/<スラッグ>` の本体。**
//
// `/spot/...` という2つ目の「場所のページ」は作らない——同じものを二度
// 作る形で、このリポジトリが何度も踏んでいる。既にある集約ページを育てる。
//
// **SEO の判定には一切触っていない。** `generateStaticParams` /
// `generateMetadata`（canonical・サイトマップ・`noindex`）は
// `lib/server/collections.ts` のまま、`collectEntries` /
// `isIndexableCollection` も素通り。変えたのは**画面に出る中身だけ**。
//
// タグ・カテゴリ・機材は `CollectionPage` のまま（この画面は撮影地専用）。

import { notFound } from "next/navigation";
import SpotPageClient from "./SpotPageClient";
import { loadAllPhotos } from "@/lib/server/photos";
import {
    photosInCollection,
    labelForSlug,
    collectionCopy,
    collectionPath,
    canonicalCollectionPath,
    relatedEntries,
    slugify,
} from "@/lib/utils/collections";
import { relatedCollectionPhotos, slimForGrid, slimForViewer } from "@/lib/utils/related";
import type { Photo } from "@/lib/data/photos";
import { spotDetail } from "@/lib/utils/spot";
import { spotMasterFor } from "@/lib/data/spotMaster";
import { spotLinkForPhoto, type SpotLink as GuideLink } from "@/lib/data/spotLink";
import { siteConfig, generateStructuredData, generateBreadcrumbStructuredData } from "@/lib/utils/seo";

/** 「ほかにこんな写真も」を出す枚数の線。これ未満のページにだけ足す（`CollectionPage` と同じ） */
const RELATED_PHOTOS_WHEN_FEWER_THAN = 6;

/** 不正な % シーケンスで**ビルドごと落とさない**（`collectionPath` と同じ守り） */
function decodeSlugSafe(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

export default async function SpotPage({ slug }: { slug: string }) {
    const photos = await loadAllPhotos();
    const matched = photosInCollection(photos, "location", slug);
    if (matched.length === 0) notFound();

    const label = labelForSlug(photos, "location", slug);
    /**
     * **保存する鍵は、正規化したスラッグ。**
     *
     * ルートのパラメータは**非ASCII だとエンコードされた形で渡ってくる**
     * （`collectionPath` のコメント）。素のまま「行きたい場所」に保存すると、
     * 一覧（`/saved-spots`）が `collectEntries` の生スラッグ（`パリ`）と
     * 突き合わせに行って**日本語の撮影地すべてで外れる**——見出しが
     * スラッグのまま・枚数なしで並ぶ。
     *
     * 集約ページの他の経路は必ずデコード＋`slugify` を通している
     * （`photosInCollection` / `labelForSlug` の `normalizeParam`）。同じ形に揃える。
     * 既に正規化済みの値を通しても変わらない（冪等）。
     */
    const savedKey = slugify(decodeSlugSafe(slug), "location");
    const { heading, description, breadcrumb } = collectionCopy("location", label, matched.length);
    /**
     * 人が書いたぶん（ふりがな・概要）。**無ければ `null`。**
     *
     * 🔴 **`collectionCopy` には渡さない。** ここを `title` や
     * `description` に流すと、**14ページぶんの `<title>` と
     * `<meta name=description>` が変わる**——URL は変わらなくても
     * 検索結果の見え方は変わるので、「SEO を壊さない」と言えなくなる
     * （`docs/spot-master.md` の4節）。出すのは**本文だけ**。
     *
     * 鍵は `savedKey`（正規化済みのスラッグ）。**正規化を2か所に置かない。**
     */
    const master = spotMasterFor(savedKey);
    const pageUrl = `${siteConfig.url}${canonicalCollectionPath("location", slug)}`;

    // **材料は1本の純関数から受け取る**（`initialRelatedFor` と同じ立場）。
    // ここで組み立てると、絞り込みを1つ消しても誰も気づかない形になる
    const { facts, coords, broader, narrower, nearby } = spotDetail(photos, label, matched);

    const link = (e: { slug: string; label: string; count: number }) => ({
        label: e.label, count: e.count, path: collectionPath("location", e.slug),
    });

    /**
     * 周辺のスポットのカードに出す1枚（モック⑨）。
     *
     * **枚数を数えたのと同じ関数から採る**（`photosInCollection`）。別の
     * 絞り方で採ると「3枚」と書いてあるカードに、その3枚に入っていない
     * 写真が出る。撮影地の一致は**緩い**（「パリ」と「パリ, フランス」を
     * 寄せる）ので、自前で `location === label` と書くと**ほとんどのカードで
     * 絵が出ない**（`CLAUDE.md` が名指ししている数え違いと同じ形）。
     *
     * 無ければ `null`。**代わりの絵を置かない**——「写真がある場所」の
     * カードなのに、持っていない絵を見せることになる。
     */
    const coverOf = (slug: string): Photo | null => {
        const first = photosInCollection(photos, "location", slug)[0];
        return first ? slimForGrid(first) : null;
    };

    // 同タイプの他ページへの相互リンク（孤立防止・回遊・SEO）。**既存のまま**
    const related = relatedEntries(photos, "location", slug, 12).map(link);

    const nearbyPhotos = matched.length < RELATED_PHOTOS_WHEN_FEWER_THAN
        ? relatedCollectionPhotos(matched, photos, 6)
        : [];

    // **クライアントへ渡すのはグリッドが読む項目だけ**（`CollectionPage` と同じ）。
    // **JSON-LD は絞る前の `matched` から作る**（あちらが項目を増やした日に
    // 構造化データだけ黙って痩せるのを避ける）
    const galleryData = generateStructuredData(matched, { name: heading, description, url: pageUrl });
    const breadcrumbData = generateBreadcrumbStructuredData([
        { name: "ホーム", url: siteConfig.url },
        { name: breadcrumb, url: pageUrl },
    ]);

    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(galleryData) }} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbData) }} />
            <SpotPageClient
                slug={savedKey}
                name={label}
                // **共有する URL は canonical**。画面側で `window.location` から
                // 組み立てると、クエリ（`?utm_…`）が付いたまま配られる
                canonicalUrl={pageUrl}
                reading={master?.reading ?? null}
                summary={master?.summary ?? null}
                heading={heading}
                description={description}
                breadcrumb={breadcrumb}
                // **ビューアのぶんまで持たせる**（`slimForViewer`）。
                // 格子だけの絞り（`slimForGrid`）を渡していたので、その場で
                // 拡大したときに説明文・撮影情報・投稿者・BGM・原寸の AVIF が
                // **黙って空**になっていた（2026-09-22 のレビューで発覚）。
                // 「ほかにこんな写真も」は格子から個別ページへ行くだけなので、
                // そちらは `slimForGrid` のまま
                photos={matched.map(slimForViewer)}
                nearbyPhotos={nearbyPhotos.map(slimForGrid)}
                facts={facts}
                coords={coords}
                broader={broader.map(link)}
                narrower={narrower.map(link)}
                nearby={nearby.map((n) => ({ ...link(n), km: n.km, approx: n.approx, cover: coverOf(n.slug) }))}
                related={related}
                guides={guidesFor(matched)}
            />
        </>
    );
}

/**
 * この撮影地の写真が **`spotId` で紐付いている**公式ガイド（重複なし・多い順・最大3件）。
 * 撮影地の文字列とスポットの名前が似ているだけでは入れない（owner の指示書 第11章）
 */
export function guidesFor(matched: readonly Photo[]): GuideLink[] {
    const count = new Map<string, number>();
    for (const p of matched) {
        const id = typeof p.spotId === "string" ? p.spotId : "";
        if (id) count.set(id, (count.get(id) ?? 0) + 1);
    }
    return [...count.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([id]) => spotLinkForPhoto(id))
        .filter((g): g is GuideLink => !!g)
        .slice(0, 3);
}
