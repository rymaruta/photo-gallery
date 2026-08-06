"use client";

import Link from "next/link";
import GalleryGrid from "./GalleryGrid";
import { useLocale } from "../i18n/context";
import type { Photo } from "@/lib/data/photos";

type Props = {
    photos: Photo[];
    heading: string;
    description: string;
    breadcrumb: string;
};

/** タグ/場所/カテゴリの集約ページ本体（見出し＋パンくず＋グリッド） */
export default function CollectionPageClient({ photos, heading, description, breadcrumb }: Props) {
    const { locale } = useLocale();

    return (
        <main className="mx-auto max-w-6xl px-4 py-8">
            <nav aria-label="breadcrumb" className="mb-3 text-sm text-white/60">
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
        </main>
    );
}
