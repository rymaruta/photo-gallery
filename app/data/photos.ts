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

    // sample8
    {
        id: "8",
        src: "/images/sample8.JPG",
        slug: "sample-8",
        title: { ja: "北欧の朝", en: "Nordic Morning" },
        alt: { ja: "北欧の朝", en: "Nordic morning" },
        description: {
            ja: [
                "ガラス越しに視界いっぱいに北欧の森と空が広がる不思議な空間だ。",
                "外は氷点下の世界だというのに、風の音ひとつ聞こえない。",
                "驚くべきはフィンランドのイグルーには室内にサウナがついていることだ。",
                "さすが北欧だ。",
            ],
            en: [
                "A mysterious space where Nordic forests and sky spread across the view through the glass.",
                "Outside is a sub-zero world, yet not a single sound of wind can be heard.",
                "What's surprising is that Finnish igloos have saunas inside.",
                "Truly Nordic.",
            ],
        },
        category: "landscape",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },

    // sample9
    {
        id: "9",
        src: "/images/sample9.JPG",
        slug: "sample-9",
        title: { ja: "サーリセルカの街灯", en: "Streetlights of Saariselkä" },
        alt: { ja: "サーリセルカの街灯", en: "Streetlights of Saariselkä" },
        description: {
            ja: [
                "サーリセルカの街灯は、デザインが美しい。",
                "静けさの中、街灯が光を放っている。",
            ],
            en: [
                "The streetlights of Saariselkä have beautiful designs.",
                "In the silence, the streetlights cast their glow.",
            ],
        },
        category: "landscape",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },

    // sample10
    {
        id: "10",
        src: "/images/sample10.JPG",
        slug: "sample-10",
        title: { ja: "木こりのろうそく橋", en: "Lumberjack's Candle Bridge" },
        alt: { ja: "木こりのろうそく橋", en: "Lumberjack's Candle Bridge" },
        description: {
            ja: [
                "フィンランド北部の街ロヴァニエミには、日本人にも有名な橋がある。",
                "低い太陽のオレンジ色が凍り付いたケミ川に反射している。",
            ],
            en: [
                "The bridge in Rovaniemi is famous among Japanese people.",
                "The orange color of the low sun reflects on the frozen Kemijoki river.",
            ],
        },
        category: "landscape",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },

    // sample11
    {
        id: "11",
        src: "/images/sample11.JPG",
        slug: "sample-11",
        title: { ja: "Löyly", en: "Löyly" },
        alt: { ja: "Löyly", en: "Löyly" },
        description: {
            ja: [
                "モダンな木造建築が美しい、ヘルシンキのサウナ「Löyly」",
                "スモークと薪、2種類のサウナで限界まで温まったあと、そのまま12月のバルト海へ",
                "梯子を降りて浸かった海は痺れるような冷たさで、濡れた肌に外気が容赦なく突き刺さり、すぐにまたサウナへ駆け込んだ。",
                "フィンランドの冬を肌で感じた一日。一生忘れられない体験になった。"
            ],
            en: [
                "Löyly in Helsinki. Modern wooden building with beautiful design.",
                "There are two types of sauna: smoke sauna and wood sauna. After sweating with two types of heat, I jumped into the Baltic Sea in December.",
                "The sea was so cold that it made my body numb, but the afterglow was the best.",
                "I experienced the winter of Finland with my skin. It was an unforgettable experience.",
            ],
        },
        category: "landscape",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },

    // sample13
    {
        id: "13",
        src: "/images/sample13.JPG",
        slug: "sample-13",
        title: { ja: "ヘルシンキ大聖堂", en: "Helsinki Cathedral" },
        alt: { ja: "ヘルシンキ大聖堂", en: "Helsinki Cathedral" },
        description: {
            ja: [
                "ヘルシンキのシンボル、ヘルシンキ大聖堂。",
                "元老院広場から見上げると、その白さと大きさに圧倒される。 ",
                "冬の青空の下でも、この建物だけが発光しているように白く輝いていた。"
            ],
            en: [
                "The symbol of Helsinki, Helsinki Cathedral.",
                "Looking up from Senate Square, one is overwhelmed by its whiteness and size.",
                "Even under the winter blue sky, this building alone glowed white as if emitting light.",
            ],
        },
        category: "landscape",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },

    // sample14
    {
        id: "14",
        src: "/images/sample14.JPG",
        slug: "sample-14",
        title: { ja: "ピザ店の窓", en: "Pizza Shop Window" },
        alt: { ja: "ピザ店の窓", en: "Pizza shop window" },
        description: {
            ja: [
                "料理ができるまでの間、窓の外の雪景色を眺めながら撮った1枚。",
                "ここで食べたピザは、生地が薄くサクサク。シンプルでありながらいつでも食べたい美味しさだった。",
            ],
            en: [
                "While waiting for the pizza to be ready, I took a photo of the snow-covered view outside the window.",
                "The pizza I ate here was thin and crispy. It was simple but always delicious.",
            ],
        },
        category: "landscape",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },

    // sample15
    {
        id: "15",
        src: "/images/sample15.JPG",
        slug: "sample-15",
        title: { ja: "ヘルシンキの街並み", en: "Streets of Helsinki" },
        alt: { ja: "ヘルシンキの街並み", en: "Streets of Helsinki" },
        description: {
            ja: [
                "大聖堂を目指して歩いている時の風景。",
                "歴史ある石造りの建物が並ぶ、ヘルシンキらしい街角。"
            ],
            en: [
                "A scene while walking toward the cathedral.",
                "A typical Helsinki street corner lined with historic stone buildings.",
            ],
        },
        category: "landscape",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },

    // sample16
    {
        id: "16",
        src: "/images/sample16.JPG",
        slug: "sample-16",
        title: { ja: "北欧の森", en: "Nordic Forest" },
        alt: { ja: "北欧の森", en: "Nordic forest" },
        description: {
            ja: [
                "フィンランドの森は、緑が深く、木々が高く、空が青く、水が透明である。",
            ],
            en: [
                "The forest in Finland is deep green, the trees are tall, the sky is blue, and the water is transparent.",
            ],
        },
        category: "nature",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },

    // sample17
    {
        id: "17",
        src: "/images/sample17.JPG",
        slug: "sample-17",
        title: { ja: "森の中の小屋", en: "Cabin in the Forest" },
        alt: { ja: "森の中の小屋", en: "Cabin in the forest" },
        description: {
            ja: [
                "雪深い木立の中に、ポツンと佇む小さな建物。",
                "煙突から静かに立ち昇る煙だけが、そこがスモークサウナであることを告げていた。",
                "──ヴァンター、Kuusijärviにて。",
            ],
            en: [
                "A small building standing alone in the snow-covered grove.",
                "Only the smoke quietly rising from the chimney told us it was a smoke sauna.",
                "— In Vantaa, Kuusijärvi.",
            ],
        },
        category: "landscape",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },

    // sample18
    {
        id: "18",
        src: "/images/sample18.JPG",
        slug: "sample-18",
        title: { ja: "Löylyのレストラン", en: "Löyly Restaurant" },
        alt: { ja: "Löylyのレストラン", en: "Löyly restaurant" },
        description: {
            ja: [
                "Löylyに併設された、海辺のレストラン。",
                "視界に入るすべてが絵になる、洗練された空間。"
            ],
            en: [
                "The restaurant built into Löyly is stylish.",
                "Everything in the view is a work of art.",
            ],
        },
        category: "landscape",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },

    // sample19
    {
        id: "19",
        src: "/images/sample19.JPG",
        slug: "sample-19",
        title: { ja: "レストランからの夕焼け", en: "Sunset from the Restaurant" },
        alt: { ja: "レストランからの夕焼け", en: "Sunset from the restaurant" },
        description: {
            ja: [
              "夕焼けとシルエットが織りなす、静かな陰影。"
            ],
            en: [
                "The sunset and silhouette create a quiet shadow.",
            ],
        },
        category: "landscape",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },

    // sample20
    {
        id: "20",
        src: "/images/sample20.jpg",
        slug: "sample-20",
        title: { ja: "フィンランドの大地", en: "Land of Finland" },
        alt: { ja: "フィンランドの大地", en: "Land of Finland" },
        description: {
            ja: [
                "美しすぎて言葉にならない、フィンランドの大地。",
            ],
            en: [
                "The land of Finland is too beautiful to be described in words.",
            ],
        },
        category: "nature",
        tags: ["photography"],
        photographer: "丸田　竜平",
        published: true,
    },
];

export default BASE_PHOTOS;

