// app/data/photos.ts

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
    createdAt?: string;
    updatedAt?: string;
    exif?: {
        camera?: string;
        lens?: string;
        aperture?: string;
        exposure?: string;
        iso?: number;
        focalLength?: string;
    };
    translationStatus?: { ja?: boolean; en?: boolean };
    relatedIds?: string[];
    likes?: number;
    views?: number;
    sourceUrl?: string;
    sensitive?: boolean;
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
    // sample1: 国営ひたち海浜公園
    {
        id: "1",
        src: "/images/sample1.jpg",
        slug: "hitachi-seaside-park",
        title: { ja: "国営ひたち海浜公園", en: "Hitachi Seaside Park" },
        alt: { ja: "国営ひたち海浜公園の風景", en: "Scenery at Hitachi Seaside Park" },
        description: {
            ja: [
                "青く広がるネモフィラの海。静かな陽光が花を淡く染め、季節の移ろいを感じさせる。",
                "散策路を歩きながら見つけた小さな視点から切り取った一枚です。"
            ],
            en: [
                "A vast sea of nemophila blooms in gentle sunlight, capturing the hush of the season.",
                "Taken from a small vantage along the path, a quiet moment in a busy park."
            ],
        },
        category: "landscape",
        tags: ["park", "flowers", "nemophila"],
        photographer: "丸田　竜平",
        location: "茨城県 ひたちなか市 国営ひたち海浜公園",
        coords: { lat: 36.341, lng: 140.525 },
        mapLinks: {
            google: "https://maps.app.goo.gl/dDGdrcUuJhqB4wmTA",
        },
        license: "All rights reserved",
        copyrightOwner: "丸田　竜平",
        copyrightYear: "2025",
        date: "2025-11-15",
        width: 4000,
        height: 2667,
        aspectRatio: 1.5,
        focalPoint: { x: 0.5, y: 0.45 },
        published: true,
        createdAt: "2025-11-15T00:00:00Z",
    },

    // sample2: 高屋神社
    {
        id: "2",
        src: "/images/sample2.jpg",
        slug: "takaya-shrine",
        title: { ja: "高屋神社", en: "Takaya Shrine" },
        alt: { ja: "高屋神社の鳥居と遠景", en: "Torii at Takaya Shrine with distant view" },
        description: {
            ja: [
                "山頂に立つ鳥居と、それを取り囲む静謐な風景。早朝の霧が遠景を柔らかくぼかしていた。",
            ],
            en: [
                "A torii perched atop the summit, framed by tranquil surroundings and softened by morning mist.",
            ],
        },
        category: "landscape",
        tags: ["torii", "shrine", "mountain"],
        photographer: "丸田　竜平",
        location: "香川県 観音寺市 高屋神社（粟積山）",
        coords: { lat: 34.18, lng: 133.78 },
        license: "All rights reserved",
        copyrightOwner: "丸田　竜平",
        copyrightYear: "2024",
        date: "2024-10-01",
        published: true,
    },

    // sample3: オペラ座
    {
        id: "3",
        src: "/images/sample3.jpg",
        slug: "opera-house",
        title: { ja: "オペラ座", en: "Opera House" },
        alt: { ja: "オペラ座の外観", en: "Opera House exterior" },
        description: {
            ja: [
                "威厳あるファサードが夕暮れの光を受けて表情を変える瞬間をとらえました。",
                "細部の装飾と人々の気配が混ざり合う、都市の一コマです。"
            ],
            en: [
                "Captured the opera house façade as it shifted under evening light, revealing new character.",
                "A slice of city life where ornate detail meets the passing crowd."
            ],
        },
        category: "architecture",
        tags: ["opera", "theater"],
        photographer: "丸田　竜平",
        location: "オペラ座（場所表記はテンプレ）",
        mapLinks: {
            google: "https://maps.app.goo.gl/EXAMPLE_SHORTLINK_3",
        },
        published: true,
    },

    // sample4: 北海道の桜
    {
        id: "4",
        src: "/images/sample4.jpg",
        slug: "hokkaido-cherry",
        title: { ja: "北海道の桜", en: "Cherry Blossoms in Hokkaido" },
        alt: { ja: "北海道の桜並木", en: "Cherry blossoms in Hokkaido" },
        description: {
            ja: [
                "凛とした冷気の中で咲く桜。春の訪れを告げる花たちの鮮烈な彩りが印象的でした。",
            ],
            en: [
                "Cherry trees blooming in crisp northern air; their vivid colors announce the arrival of spring.",
            ],
        },
        category: "nature",
        tags: ["cherry", "hokkaido"],
        photographer: "丸田　竜平",
        location: "北海道",
        mapLinks: {
            google: "https://maps.app.goo.gl/EXAMPLE_SHORTLINK_4",
        },
        published: true,
    },

    // sample5: ヴェルサイユ宮殿
    {
        id: "5",
        src: "/images/sample5.jpg",
        slug: "versailles-palace",
        title: { ja: "ヴェルサイユ宮殿", en: "Palace of Versailles" },
        alt: { ja: "ヴェルサイユ宮殿の庭園", en: "Gardens of the Palace of Versailles" },
        description: {
            ja: [
                "広大な庭園と整えられた並木道。歴史の重みを感じさせる光と陰の対比を意識して撮影しました。",
            ],
            en: [
                "Vast gardens and manicured avenues; photographed to emphasize the contrast of light and shadow across history-steeped grounds.",
            ],
        },
        category: "architecture",
        tags: ["versailles", "palace"],
        photographer: "丸田　竜平",
        location: "フランス ヴェルサイユ",
        mapLinks: {
            google: "https://maps.app.goo.gl/EXAMPLE_SHORTLINK_5",
        },
        published: true,
    },

    // sample6: パリの街中
    {
        id: "6",
        src: "/images/sample6.jpg",
        slug: "paris-streets",
        title: { ja: "パリの街中", en: "Streets of Paris" },
        alt: { ja: "パリの街並み", en: "Paris street scene" },
        description: {
            ja: [
                "石畳に反射する夕暮れの光、人々の断片的な動き。街の息遣いを切り取った一枚です。",
            ],
            en: [
                "Evening light reflecting on cobblestones and fragments of passing life; a portrait of city rhythm.",
            ],
        },
        category: "street",
        tags: ["paris", "street"],
        photographer: "丸田　竜平",
        location: "パリ, フランス",
        mapLinks: {
            google: "https://maps.app.goo.gl/EXAMPLE_SHORTLINK_6",
        },
        published: true,
    },

    // sample7: ヴェルサイユ宮殿（重複タイトル）
    {
        id: "7",
        src: "/images/sample7.jpg",
        slug: "versailles-palace-2",
        title: { ja: "ヴェルサイユ宮殿", en: "Palace of Versailles (2)" },
        alt: { ja: "ヴェルサイユ宮殿の別視点", en: "Another view of the Palace of Versailles" },
        description: {
            ja: [
                "庭園の奥まった視点から捉えた別の構図。対称性と遠近が織りなす風景を意識しました。",
            ],
            en: [
                "An alternative composition from a tucked-away vantage in the gardens, focusing on symmetry and perspective.",
            ],
        },
        category: "architecture",
        tags: ["versailles", "palace"],
        photographer: "丸田　竜平",
        location: "フランス ヴェルサイユ",
        mapLinks: {
            google: "https://maps.app.goo.gl/EXAMPLE_SHORTLINK_7",
        },
        published: true,
    },
];

export default BASE_PHOTOS;
