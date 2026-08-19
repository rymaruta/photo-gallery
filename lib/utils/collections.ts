// lib/utils/collections.ts
// タグ / 場所 / カテゴリの集約（ランディング）ページ用の純関数ユーティリティ。
// fs や JSX を持たないため、サーバー・クライアント・テストのどこからでも読める。

import type { Photo } from "../data/photos";

export type CollectionType = "tag" | "location" | "category";

/**
 * カテゴリの日本語表記を英語キーへ寄せる表。
 * 「風景」と「landscape」が別ページになると、同じ内容が2つのURLに分かれて
 * どちらも弱くなるため、集約ページを作る段階で1つにまとめる。
 * 表記ゆれ（建物→建築）もここで吸収する。
 */
const CATEGORY_ALIASES: Record<string, string> = {
    "風景": "landscape",
    "自然": "nature",
    "建築": "architecture",
    "建物": "architecture",
    "街": "street",
    "写真": "photography",
    "イラスト": "illustration",
    "デザイン": "design",
};

/** 値を URL スラッグへ正規化（小文字化・trim・空白をハイフンに）。日本語はそのまま（URLでは percent-encoded）。 */
export function slugify(value: string, type?: CollectionType): string {
    const base = (value ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");
    if (type === "category") return CATEGORY_ALIASES[base] ?? base;
    return base;
}

/**
 * 検索エンジンに載せてよい最小の写真枚数。
 * 写真1〜2枚＋定型文だけのページを大量に作ると「中身の薄いサイト」と
 * 判断されて全体の評価が下がる。人がサイト内から辿る分には見られる。
 */
export const MIN_INDEXABLE_COUNT = 3;

/** そのページを検索エンジンに載せてよいか */
export function isIndexableCollection(count: number): boolean {
    return count >= MIN_INDEXABLE_COUNT;
}

/**
 * 統合前の旧スラッグのうち、実際に写真が使っているもの。
 *
 * カテゴリを統合すると、それまで公開していた `/category/風景` などが
 * 生成されなくなる。静的エクスポート + dynamicParams=false ではリダイレクトの
 * 層が無いためハード404になり、外部リンクや検索結果からの流入を落としてしまう。
 * 旧URLもページとして残し、canonical で統合後へ寄せる。
 */
export function legacyCategorySlugs(photos: Photo[]): string[] {
    const out = new Set<string>();
    for (const p of photos) {
        if (!isPublished(p)) continue;
        const raw = (p.category ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");
        // 別名表に載っていて、かつ統合後の名前と違うものだけが「旧URL」
        const canonical = CATEGORY_ALIASES[raw];
        if (canonical && canonical !== raw) out.add(raw);
    }
    return [...out];
}

/** 統合後の正しいスラッグ（旧スラッグを渡すと統合後を返す） */
export function canonicalCategorySlug(slug: string): string {
    return slugify(decodeURIComponentSafe(slug), "category");
}

/** ルートパラメータ（既にデコード済みのことが多いが念のため）を安全にデコードして正規化 */
function normalizeParam(slug: string, type?: CollectionType): string {
    let s = slug ?? "";
    try {
        s = decodeURIComponent(s);
    } catch {
        // 不正な % シーケンスはそのまま扱う
    }
    return slugify(s, type);
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
            const slug = slugify(v, type);
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
    const target = normalizeParam(slug, type);
    if (!target) return [];
    return photos.filter((p) => isPublished(p) && valuesFor(p, type).some((v) => slugify(v, type) === target));
}

/** slug に対応する代表表示ラベル（最初に一致した生の値）。無ければデコードした slug。 */
export function labelForSlug(photos: Photo[], type: CollectionType, slug: string): string {
    const target = normalizeParam(slug, type);
    for (const p of photos) {
        for (const v of valuesFor(p, type)) {
            if (slugify(v, type) === target) return v;
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

/** ランディングページの見出し・メタ文言（日本語主体・ページ固有の導入文つき） */
export function collectionCopy(type: CollectionType, label: string, count: number): CollectionCopy {
    const kindJa = type === "tag" ? "タグ" : type === "location" ? "撮影地" : "カテゴリ";
    const heading =
        type === "location" ? `${label}の写真` : type === "category" ? `${label}の写真` : `#${label} の写真`;
    const title = `${label}の写真${count ? `（${count}枚）` : ""} | 旅フォトギャラリー`;
    const description =
        type === "location"
            ? `${label}で撮影した旅の写真${count ? `${count}枚` : ""}を掲載。現地で切り取った風景やスナップを、撮影地・カメラ情報（EXIF）付きで紹介します。${label}への旅の参考にどうぞ。`
            : type === "category"
                ? `${label}カテゴリの旅写真${count ? `${count}枚` : ""}を掲載。国内外の旅先で撮影した${label}の作品を、撮影地やカメラ情報（EXIF）と合わせて閲覧できます。`
                : `「${label}」に関する旅の写真${count ? `${count}枚` : ""}を掲載。${label}のタグが付いた作品を、撮影地・カメラ情報（EXIF）付きでまとめています。`;
    return { title, description, heading, breadcrumb: `${kindJa}: ${label}` };
}

/**
 * 同タイプの他の集約エントリ（現在の slug を除く・件数順）。
 * ランディングページ同士の相互リンク（孤立防止・回遊）に使う。
 */
export function relatedEntries(photos: Photo[], type: CollectionType, slug: string, limit = 12): CollectionEntry[] {
    const current = slugify(decodeURIComponentSafe(slug), type);
    return collectEntries(photos, type)
        .filter((e) => e.slug !== current)
        .slice(0, limit);
}

function decodeURIComponentSafe(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}
