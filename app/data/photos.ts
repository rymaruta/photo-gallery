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
        slug: "sea-of-nemophila",
        title: { ja: "海", en: "Sea of Nemophila" },
        alt: { ja: "ネモフィラの海の風景", en: "Sea of nemophila in bloom" },
        description: {
            ja: [
                "青く広がるネモフィラの海。",
                "公園の中で見つけたポピーを軸に切り取った一枚だ。",
                "少し歩くと遊園地もあり、家族連れで賑わっていた。",
            ],
            en: [
                "A vast sea of nemophila stretching in soft blue tones.",
                "This shot frames a single poppy blooming amid the flowers.",
                "A short walk away is an amusement area, lively with families.",
            ],

        },
        category: "landscape",
        tags: ["park", "flowers", "nemophila"],
        photographer: "丸田　竜平",
        location: "茨城県 ひたちなか市 国営ひたち海浜公園",
        coords: { lat: 36.341, lng: 140.525 },
        mapLinks: {
            google: "https://maps.app.goo.gl/UML3RZDaMTVB6HpH8",
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
        title: { ja: "天空の鳥居", en: "Torii in the Sky" },
        alt: { ja: "高屋神社の鳥居と遠景", en: "Torii at Takaya Shrine with distant view" },
        description: {
            ja: [
                "山頂に立つ鳥居から見た景色は、まさに絶景だった。",
                "下宮までの道中、タクシーの運転手さんは香川が一番好きだと言っていた。",
                "愛が感じられる土地だ。",
            ],
            en: [
                "The view from the torii at the summit was truly breathtaking.",
                "On the way down to the lower shrine, the taxi driver told me Kagawa was his favorite place.",
                "There is a palpable sense of affection in this land.",
            ],

        },
        category: "landscape",
        tags: ["torii", "shrine", "mountain"],
        photographer: "丸田　竜平",
        location: "香川県 観音寺市 高屋神社",
        coords: { lat: 34.18, lng: 133.78 },
        mapLinks: {
            google: "https://maps.app.goo.gl/dDGdrcUuJhqB4wmTA",
        },
        license: "All rights reserved",
        copyrightOwner: "丸田　竜平",
        copyrightYear: "2024",
        date: "2024-10-01",
        published: true,
    },

    // sample3: オペラ・ガルニエ
    {
        id: "3",
        src: "/images/sample3.jpg",
        slug: "opera-house",
        title: { ja: "オペラ・ガルニエ", en: "Palais Garnier" },
        alt: { ja: "オペラ・ガルニエの外観", en: "Exterior of the Palais Garnier" },
        description: {
            ja: [
                "世界三大劇場の一つ、オペラ・ガルニエ。",
                "「死ぬまでに一度は訪れたい」と思っていた場所だ。",
                "ー 細部まで威厳ある装飾と光が織り成す美しさ ー",
                "それを確かめたくてシャッターを切った。",
            ],
            en: [
                "One of the world's great opera houses, the Palais Garnier.",
                "It was a place I had long wanted to visit at least once in my life.",
                "— The solemn beauty of ornament and light visible down to the smallest detail —",
                "I photographed it to see and capture that very quality.",
            ],
        },
        category: "architecture",
        tags: ["opera", "theater"],
        photographer: "丸田　竜平",
        location: "オペラ・ガルニエ（パリ）",
        mapLinks: {
            google: "https://maps.app.goo.gl/9Ze91AJATzr2dnwT7",
        },
        published: true,
    },

    // sample4: 北海道の桜
    {
        id: "4",
        src: "/images/sample4.jpg",
        slug: "hokkaido-cherry",
        title: { ja: "北海道の桜", en: "Cherry Blossoms in Hokkaido" },
        alt: { ja: "北海道の桜", en: "Cherry blossoms in Hokkaido" },
        description: {
            ja: [
                "北海道にも春が訪れ、桜が咲き誇る季節となった。",
                "木々の隙間から差し込む柔らかな光が、花びらを優しく照らしている。",
            ],
            en: [
                "Spring has come to Hokkaido, and cherry trees are in full bloom.",
                "Soft light filters through the trees, gently illuminating the petals.",
            ],
        },
        category: "nature",
        tags: ["cherry", "hokkaido"],
        photographer: "丸田　竜平",
        location: "北海道",
        mapLinks: {
            google: "https://maps.app.goo.gl/3naKGRevHMBZW1PM7",
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
                "広大な庭園と整えられた並木道。",
                "そんな帰り際の1枚。人生で一番美しい夕焼けだった。",
                "ー 黄昏のヴェルサイユ宮殿 ー",
            ],
            en: [
                "Vast gardens and manicured avenues.",
                "A shot taken on the way back, during perhaps the most beautiful sunset I've seen.",
                "— Versailles at dusk —",
            ],
        },
        category: "architecture",
        tags: ["versailles", "palace"],
        photographer: "丸田　竜平",
        location: "フランス ヴェルサイユ",
        mapLinks: {
            google: "https://maps.app.goo.gl/pQbfgnx7MMqfKcFp7",
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
                "パリは何を撮っても絵になる街だ。",
                "光がじんわりと広がる、そんな日常の一コマだ。",
            ],
            en: [
                "Paris turns almost any scene into a postcard.",
                "A quiet everyday moment where the light spreads gently across the street.",
            ],
        },
        category: "street",
        tags: ["paris", "street"],
        photographer: "丸田　竜平",
        location: "パリ, フランス",
        mapLinks: {
            google: "https://maps.app.goo.gl/iZwj9Vhx7xz8HrRx5",
        },
        published: true,
    },

    // sample7: 大トリアノン宮殿
    {
        id: "7",
        src: "/images/sample7.jpg",
        slug: "grand-trianon",
        title: { ja: "大トリアノン宮殿", en: "Grand Trianon" },
        alt: { ja: "大トリアノン宮殿", en: "The Grand Trianon" },
        description: {
            ja: [
                "トリアノン群と呼ばれる宮殿の一つ。",
                "プチトランと呼ばれる小さな列車で庭園を巡った。",
                "大理石と列柱が織りなす落ち着いた佇まいが印象的だった。",
            ],
            en: [
                "One of the palaces in the Trianon ensemble.",
                "I toured the gardens aboard the little train known as the 'petit train'.",
                "The calm elegance formed by marble and colonnades left a strong impression.",
            ],
        },
        category: "architecture",
        tags: ["versailles", "trianon"],
        photographer: "丸田　竜平",
        location: "フランス ヴェルサイユ",
        mapLinks: {
            google: "https://maps.app.goo.gl/pQbfgnx7MMqfKcFp7",
        },
        published: true,
    },
];

export default BASE_PHOTOS;

