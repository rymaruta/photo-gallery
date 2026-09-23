"use client";

import Link from "next/link";
import GalleryGrid from "./GalleryGrid";
import { GRID_SIZES_6XL } from "./gridSizes";
import { useLocale } from "../i18n/context";
import type { Photo } from "@/lib/data/photos";
import type { CollectionType } from "@/lib/utils/collections";

type RelatedLink = { label: string; count: number; path: string };

type Props = {
    photos: Photo[];
    heading: string;
    description: string;
    breadcrumb: string;
    // **型を書き下さない。** 種類が増えたときにここだけ古いままになる
    // （`camera` を足したとき実際に tsc が止めた）
    type?: CollectionType;
    related?: RelatedLink[];
    /** 写真が少ないページにだけ出す「ほかにこんな写真も」 */
    nearby?: Photo[];
};

const RELATED_HEADING: Record<CollectionType, { ja: string; en: string }> = {
    tag: { ja: "関連タグ", en: "Related tags" },
    location: { ja: "他の撮影地", en: "More locations" },
    category: { ja: "他のカテゴリ", en: "More categories" },
    camera: { ja: "他のカメラ", en: "More cameras" },
};

/** タグ/場所/カテゴリ/カメラの集約ページ本体（見出し＋パンくず＋グリッド＋相互リンク） */
export default function CollectionPageClient({ photos, heading, description, breadcrumb, type = "tag", related = [], nearby = [] }: Props) {
    const { locale } = useLocale();

    return (
        <main className="jp-page mx-auto max-w-6xl px-4 py-8">
            <nav aria-label="パンくずリスト" className="mb-3 text-sm text-white/60">
                <Link href="/" prefetch={false} className="hover:text-white/90">ホーム</Link>
                <span className="mx-2" aria-hidden>/</span>
                <span className="text-white/80">{breadcrumb}</span>
            </nav>

            <h1 className="jp-page__title mb-2">{heading}</h1>
            <p className="mb-6 text-sm text-white/70">
                {description}
                <span className="ml-1 whitespace-nowrap text-white/50">（{photos.length}枚）</span>
            </p>

            <GalleryGrid photos={photos} locale={locale} sizes={GRID_SIZES_6XL} />

            {/* **写真が少ないページにだけ。** 1枚だけのページは、それ自体は
                このサイトにしか無い写真でも「見るものが1つ」で終わる。
                近い写真を出すと読む価値が出て、押せば個別ページへ回遊する */}
            {nearby.length > 0 && (
                <section className="mt-10 pt-5 border-t border-white/10">
                    <h2 className="text-sm font-semibold text-white/70 mb-3">
                        {locale === "en" ? "You might also like" : "ほかにこんな写真も"}
                    </h2>
                    <GalleryGrid photos={nearby} locale={locale} sizes={GRID_SIZES_6XL} />
                </section>
            )}

            {/* 同タイプの他ページへの相互リンク（回遊・SEO） */}
            {related.length > 0 && (
                <section className="mt-10 pt-5 border-t border-white/10">
                    <h2 className="text-sm font-semibold text-white/70 mb-3">
                        {RELATED_HEADING[type]?.[locale === "en" ? "en" : "ja"] ?? "関連ページ"}
                    </h2>
                    <div className="flex flex-wrap gap-1.5">
                        {related.map((r) => (
                            // **先読みしない。** 一覧で何本も出るリンクなので、画面に入るたびに
                            // 行き先の RSC の控え（`no-store` 配信）を落とし直す。理由と実測は
                            // `app/components/GalleryGrid.tsx` のカードのコメントに書いた
                            <Link
                                key={r.path}
                                href={r.path}
                                prefetch={false}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-white/60 hover:bg-white/10 hover:text-white/90 transition-colors"
                                style={{ touchAction: "manipulation" }}
                            >
                                {type === "tag" ? `#${r.label}` : r.label}
                                <span className="text-white/50">{r.count}</span>
                            </Link>
                        ))}
                    </div>
                </section>
            )}
        </main>
    );
}
