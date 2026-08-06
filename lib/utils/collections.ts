// lib/utils/collections.ts
// タグ / 場所 / カテゴリの集約（ランディング）ページ用の純関数ユーティリティ。
// fs や JSX を持たないため、サーバー・クライアント・テストのどこからでも読める。

import type { Photo } from "../data/photos";

export type CollectionType = "tag" | "location" | "category";

/** 値を URL スラッグへ正規化（小文字化・trim・空白をハイフンに）。日本語はそのまま（URLでは percent-encoded）。 */
export function slugify(value: string): string {
    return (value ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");
}

/** ルートパラメータ（既にデコード済みのことが多いが念のため）を安全にデコードして正規化 */
function normalizeParam(slug: string): string {
    let s = slug ?? "";
    try {
        s = decodeURIComponent(s);
    } catch {
        // 不正な % シーケンスはそのまま扱う
    }
    return slugify(s);
}

/** 写真から、指定タイプの生の値（表示ラベル候補）を取り出す */
function valuesFor(p: Photo, type: CollectionType): string[] {
    if (type === "tag") {
        return (p.tags ?? []).map((t) => (t ?? "").toString().trim()).filter(Boolean);
    }
    if (type === "location") {
        return p.location ? [p.location.toString().trim()].filter(Boolean) : [];
    }
    // category
    return p.category ? [p.category.toString().trim()].filter(Boolean) : [];
}

const isPublished = (p: Photo) => p.published !== false;

export type CollectionEntry = { slug: string; label: string; count: number };

/**
 * 全写真から、指定タイプの一意な集約エントリ（slug / 代表ラベル / 件数）を集める。
 * 同一写真内での重複はカウントしない。件数降順・slug 昇順で安定ソート。
 */
export function collectEntries(photos: Photo[], type: CollectionType): CollectionEntry[] {
    const bySlug = new Map<string, { label: string; count: number }>();
    for (const p of photos) {
        if (!isPublished(p)) continue;
        const seen = new Set<string>();
        for (const v of valuesFor(p, type)) {
            const slug = slugify(v);
            if (!slug || seen.has(slug)) continue;
            seen.add(slug);
            const cur = bySlug.get(slug);
            if (cur) cur.count++;
            else bySlug.set(slug, { label: v, count: 1 });
        }
    }
    return [...bySlug.entries()]
        .map(([slug, { label, count }]) => ({ slug, label, count }))
        .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

/** 指定 slug に一致する（公開）写真を返す */
export function photosInCollection(photos: Photo[], type: CollectionType, slug: string): Photo[] {
    const target = normalizeParam(slug);
    if (!target) return [];
    return photos.filter((p) => isPublished(p) && valuesFor(p, type).some((v) => slugify(v) === target));
}

/** slug に対応する代表表示ラベル（最初に一致した生の値）。無ければデコードした slug。 */
export function labelForSlug(photos: Photo[], type: CollectionType, slug: string): string {
    const target = normalizeParam(slug);
    for (const p of photos) {
        for (const v of valuesFor(p, type)) {
            if (slugify(v) === target) return v;
        }
    }
    try {
        return decodeURIComponent(slug);
    } catch {
        return slug;
    }
}

const TYPE_PATH: Record<CollectionType, string> = { tag: "tag", location: "location", category: "category" };

/** 集約ページの相対 URL（/tag/<encoded slug> 等） */
export function collectionPath(type: CollectionType, slug: string): string {
    return `/${TYPE_PATH[type]}/${encodeURIComponent(slug)}`;
}

export type CollectionCopy = { title: string; description: string; heading: string; breadcrumb: string };

/** ランディングページの見出し・メタ文言（日本語主体・簡潔に） */
export function collectionCopy(type: CollectionType, label: string, count: number): CollectionCopy {
    const kindJa = type === "tag" ? "タグ" : type === "location" ? "撮影地" : "カテゴリ";
    const heading =
        type === "location" ? `${label}の写真` : type === "category" ? `${label}の写真` : `#${label} の写真`;
    const title = `${label}の写真${count ? `（${count}枚）` : ""} | 旅フォトギャラリー`;
    const description =
        type === "location"
            ? `${label}で撮影した旅の写真${count ? `${count}枚` : ""}。風景・スナップなど、${label}の一枚を集めました。`
            : type === "category"
                ? `${label}カテゴリの旅写真${count ? `${count}枚` : ""}。${label}の作品をまとめて閲覧できます。`
                : `「${label}」に関する旅の写真${count ? `${count}枚` : ""}。${label}のタグが付いた写真を集めました。`;
    return { title, description, heading, breadcrumb: `${kindJa}: ${label}` };
}
