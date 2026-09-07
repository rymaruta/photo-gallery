"use client";

import Link from "next/link";
import GalleryGrid from "./GalleryGrid";
import { useLocale } from "../i18n/context";
import type { Photo } from "@/lib/data/photos";

type RelatedLink = { label: string; count: number; path: string };

type Props = {
    photos: Photo[];
    heading: string;
    description: string;
    breadcrumb: string;
    type?: "tag" | "location" | "category";
    related?: RelatedLink[];
};

const RELATED_HEADING: Record<string, { ja: string; en: string }> = {
    tag: { ja: "関連タグ", en: "Related tags" },
    location: { ja: "他の撮影地", en: "More locations" },
    category: { ja: "他のカテゴリ", en: "More categories" },
};

/** タグ/場所/カテゴリの集約ページ本体（見出し＋パンくず＋グリッド＋相互リンク） */
export default function CollectionPageClient({ photos, heading, description, breadcrumb, type = "tag", related = [] }: Props) {
    const { locale } = useLocale();

    return (
        <main className="mx-auto max-w-6xl px-4 py-8">
            <nav aria-label="パンくずリスト" className="mb-3 text-sm text-white/60">
                <Link href="/" className="hover:text-white/90">ホーム</Link>
                <span className="mx-2" aria-hidden>/</span>
                <span className="text-white/80">{breadcrumb}</span>
            </nav>

            <h1 className="mb-2 text-2xl font-semibold tracking-tight">{heading}</h1>
            <p className="mb-6 text-sm text-white/70">
                {description}
                <span className="ml-1 whitespace-nowrap text-white/50">（{photos.length}枚）</span>
            </p>

            <GalleryGrid photos={photos} locale={locale} />

            {/* 同タイプの他ページへの相互リンク（回遊・SEO） */}
            {related.length > 0 && (
                <section className="mt-10 pt-5 border-t border-white/10">
                    <h2 className="text-sm font-semibold text-white/70 mb-3">
                        {RELATED_HEADING[type]?.[locale === "en" ? "en" : "ja"] ?? "関連ページ"}
                    </h2>
                    <div className="flex flex-wrap gap-1.5">
                        {related.map((r) => (
                            <Link
                                key={r.path}
                                href={r.path}
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
