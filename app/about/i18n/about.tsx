// app/i18n/about.ts

export type AboutContent = {
    title: string;
    description: string;
    body?: string;
    paragraphs?: string[];
    contactLine?: string;
    photographer?: {
        name?: string;
        title?: string;
    };
};

const ja: AboutContent = {
    title: "制作について",
    description: "自己紹介とサイトの概要",
    paragraphs: [
        "普段は会社員として働きながら、週末や長期休暇を使って国内外を旅しています。",
        "当サイトは旅先で出会う景色や空気を収めた小さなギャラリーです。"
    ],
    contactLine: "お問い合わせはInstagramへ",
    photographer: {
        title: "写真家",
        name: "丸田 竜平",
    },
};

const en: AboutContent = {
    title: "About",
    description: "About me and this site",
    paragraphs: [
        "I work full-time while traveling domestically and abroad on weekends and during longer breaks.",
        "This site is a small gallery that captures the scenes and atmosphere encountered during my travels."
    ],
    contactLine: "For inquiries, please contact me on Instagram",
    photographer: {
        title: "Photographer",
        name: "Ryuhei Maruta",
    },
};

export function getContent(locale: "ja" | "en" = "ja"): AboutContent {
    return locale === "en" ? en : ja;
}

export default getContent;
