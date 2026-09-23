// app/components/CollectionIndexPage.tsx（サーバーコンポーネント）
// 種別ごとの**索引ページ**（`/category` `/location` `/camera`）。
// 中身はエントリの一覧だけなので、クライアント部品には委譲しない
// （押せるものはリンクだけ＝JS が要らない）。

import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAllPhotos } from "@/lib/server/photos";
import {
    collectEntries,
    collectionPath,
    collectionIndexPath,
    collectionIndexCopy,
    isIndexableCollection,
    categoryDisplayName,
    type CollectionType,
} from "@/lib/utils/collections";
import { dedupeCameraName } from "@/lib/utils/cameraName";
import { siteConfig, generateBreadcrumbStructuredData } from "@/lib/utils/seo";

const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

/**
 * 🔴 **「すべて見る」の行き先そのもの。**
 *
 * 2026-09-22 に実ビルド（151 HTML）で数えた:
 *
 *     トップ → /category/*   0本
 *     トップ → /location/*   0本
 *     トップ → /camera/*     0本
 *     トップ → /tag/*       49本（写真カードのタグのチップ）
 *
 * ホームの柱は owner の指示で `/search?…` を向いていて、その `/search` は
 * **`robots.txt` で `Disallow`**——検索エンジンから見ると行き止まりなので、
 * 柱はリンクを1本も渡していない。
 *
 * ⚠️ **集約ページが孤立していたわけではない**（同じ実測で、noindex でない
 * 60ページのうち `/category/*` へ37・`/location/*` へ22・`/camera/*` へ34 が
 * 張っている＝主に写真ページから。トップから2クリックでは届く）。
 * 足りなかったのは**トップからの1本**と、「すべて見る」の行き先。
 *
 * **枠だけ置かない。** この索引は `collectEntries` が返すものを全部並べる
 * ので、「すべて見る」という言葉が実際に正しい。エントリが0件なら
 * `notFound()`（空の索引を置かない）。
 */
export default async function CollectionIndexPage({ type }: { type: CollectionType }) {
    const photos = await loadAllPhotos();
    const entries = collectEntries(photos, type);
    if (entries.length === 0) notFound();

    const { heading, description, breadcrumb } = collectionIndexCopy(type, entries.length);
    const pageUrl = `${siteConfig.url}${collectionIndexPath(type)}`;

    const breadcrumbData = generateBreadcrumbStructuredData([
        { name: "ホーム", url: siteConfig.url },
        { name: breadcrumb, url: pageUrl },
    ]);

    /**
     * 見せる名前。**集約ページの見出しと同じ規則で出す**
     * （カテゴリは英語スラッグの日本語名、カメラは二重のメーカー名を畳む）
     * ——ここだけ別の名前にすると、押した先の題と食い違う。
     */
    const labelOf = (slug: string, label: string): string =>
        type === "category" ? (categoryDisplayName(slug) ?? label)
            : type === "camera" ? (dedupeCameraName(label) ?? label)
                : label;

    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbData) }} />
            <main className="jp-page mx-auto max-w-6xl px-4 py-8">
                <nav aria-label="パンくずリスト" className="mb-3 text-sm text-white/60">
                    <Link href="/" prefetch={false} className="hover:text-white/90">ホーム</Link>
                    <span className="mx-2" aria-hidden>/</span>
                    <span className="text-white/80">{breadcrumb}</span>
                </nav>

                <h1 className="jp-page__title mb-2">{heading}</h1>
                <p className="mb-6 text-sm text-white/70">{description}</p>

                {/* **全部並べる**（`collectEntries` の順＝枚数の多い順）。
                    枚数を添えるのは、押す前にどれが厚いページか分かるようにするため
                    ——`CollectionPageClient` の相互リンクと同じ形に揃えてある */}
                <ul className="flex flex-wrap gap-2 m-0 p-0" style={{ listStyle: "none" }}>
                    {entries.map((e) => (
                        <li key={e.slug}>
                            {/* **先読みしない**（公開ページの `<Link>` は全部そう。
                                理由は `app/components/GalleryGrid.tsx` のカードの注記） */}
                            <Link
                                href={collectionPath(type, e.slug)}
                                prefetch={false}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 ring-1 ring-white/10 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                                style={{ touchAction: "manipulation" }}
                            >
                                {type === "tag" ? `#${labelOf(e.slug, e.label)}` : labelOf(e.slug, e.label)}
                                <span className="text-white/50 text-xs">{e.count}</span>
                            </Link>
                        </li>
                    ))}
                </ul>

                {/* **検索に載る線を、読む人にも書いておく。** 枚数の少ないページは
                    `noindex` だがサイト内からは見られる（`isIndexableCollection`）。
                    ここに出しておくと「なぜ検索に出ないページがあるか」が分かる */}
                <p className="mt-6 text-xs text-white/60">
                    {`検索に載せているのは ${entries.filter((e) => isIndexableCollection(e.count, type)).length} 件です（写真が少ないページはサイト内からのみ）。`}
                </p>
            </main>
        </>
    );
}
