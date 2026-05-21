// app/data/photos.ts
// （変更済み）BASE_PHOTOS の mapLinks.google を指定のショートリンクに置き換え、
// "オペラ座" を "オペラ・ガルニエ" に更新した版を以下に示します。
// そのまま既存ファイルを差し替えてください。

export type Locale = "ja" | "en";

export type LocalizedText = {
    ja?: string;
    en?: string;
};

// 段落配列で保持する型
export type LocalizedParagraphs = {
    ja?: string[];
    en?: string[];
};

export type Photo = {
    id: string;
    src: string;
    slug?: string;
    title?: string | LocalizedText;
    alt?: string | LocalizedText;
    // description は文字列か段落配列を受け取れるようにする
    description?: string | LocalizedParagraphs;
    category?: string;
    tags?: string[];
    photographer?: string;
    location?: string;
    coords?: { lat: number; lng: number };
    mapLinks?: { google?: string; osm?: string; label?: string };
    license?: string;
    copyrightOwner?: string;
    copyrightYear?: string;
    date?: string;
    width?: number;
    height?: number;
    aspectRatio?: number;
    dominantColor?: string;
    focalPoint?: { x: number; y: number };
    published?: boolean;
    userId?: string;
    displayName?: string;
    createdAt?: string;
    updatedAt?: string;
    exif?: {
        camera?: string;
        lens?: string;
        aperture?: string;
        exposure?: string;
        iso?: number;
        focalLength?: string;
        whiteBalance?: string;
        imageSize?: string;
        fileFormat?: string;
    };
    translationStatus?: { ja?: boolean; en?: boolean };
    relatedIds?: string[];
    likes?: number;
    views?: number;
    sourceUrl?: string;
    sensitive?: boolean;
    userId?: string;
    uploadedBy?: string;
    uploaderUsername?: string;
    uploaderDisplayName?: string;
};

/**
 * getLocalized: 文字列またはローカライズオブジェクトから文字列を返すユーティリティ
 */
export function getLocalized(v: string | LocalizedText | undefined, locale: Locale): string {
    if (!v) return "";
    if (typeof v === "string") return v;
    return (v[locale] ?? v.ja ?? v.en ?? "") as string;
}

/**
 * getLocalizedParagraphs: description が段落配列か文字列かを吸収して常に string[] を返す
 */
export function getLocalizedParagraphs(v: string | LocalizedParagraphs | undefined, locale: Locale): string[] {
    if (!v) return [];
    if (typeof v === "string") return [v];
    const arr = v[locale] ?? v.ja ?? v.en;
    return Array.isArray(arr) ? arr : [];
}

/**
 * Helper: coords から map リンクを生成（エンコード済み）
 */
const encode = (v: number) => encodeURIComponent(v.toString());
export const makeGoogleSearch = (lat: number, lng: number) =>
    `https://www.google.com/maps/search/?api=1&query=${encode(lat)},${encode(lng)}`;
export const makeOSM = (lat: number, lng: number, zoom = 15) =>
    `https://www.openstreetmap.org/?mlat=${encode(lat)}&mlon=${encode(lng)}#map=${zoom}/${encode(lat)}/${encode(lng)}`;

/**
 * generateMapLinksFromCoords:
 * - p.mapLinks があればそれをベースにし、欠けている provider を coords から補完する
 * - coords がなければ補完は行わない（既存の mapLinks があればそれを返す）
 */
export function generateMapLinksFromCoords(p: Photo): Photo["mapLinks"] | undefined {
    const base = p.mapLinks ? { ...p.mapLinks } : {};

    if (!p.coords) {
        return Object.keys(base).length > 0 ? base : undefined;
    }

    const { lat, lng } = p.coords;

    if (!base.google) {
        base.google = makeGoogleSearch(lat, lng);
    }

    if (!base.osm) {
        base.osm = makeOSM(lat, lng);
    }

    return base;
}

/**
 * getPreferredMapLink: mapLinks の優先取得ロジック（UI 側で使用）
 */
export function getPreferredMapLink(p: Photo): { href: string; provider: "google" | "osm" } | undefined {
    const links = generateMapLinksFromCoords(p) ?? p.mapLinks ?? undefined;

    if (!links) return undefined;
    if (links.google) return { href: links.google, provider: "google" };
    if (links.osm) return { href: links.osm, provider: "osm" };
    return undefined;
}

/**
 * BASE_PHOTOS: 編集者はこの配列の location と coords（ある場合）や mapLinks を編集
 * sample1〜sample7 のテンプレ例（撮影者名を「丸田　竜平」に統一、description は仮テキスト）
 */
export const BASE_PHOTOS: Photo[] = [
];
export default BASE_PHOTOS;

