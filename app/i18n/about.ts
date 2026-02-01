// app/i18n/about.ts
export type AboutContent = {
    title: string;
    description: string;
    body?: string;
    paragraphs?: string[];
    contactTitle?: string;
    contactPrompt?: string;
    updatesLine?: string;
    contactUrl?: string;
    contactHandle?: string;
    photographer?: {
        name?: string;
        title?: string;
    };
};

const ja: AboutContent = {
    title: "制作について",
    description: "自己紹介とサイトの概要",
    paragraphs: [
        "当サイトは旅行中に撮影した風景写真を中心に公開しています。",
    ],
    contactTitle: "運営・お問い合わせ",
    contactPrompt: "Instagram の DM へご連絡ください。",
    updatesLine: "コンテンツは随時更新予定です。",
    contactUrl: "https://www.instagram.com/maru_chaannn",
    contactHandle: "@maru_chaannn",
    photographer: {
        title: "管理人",
        name: "丸田 竜平",
    },
};

const en: AboutContent = {
    title: "About",
    description: "About me and this site",
    paragraphs: [
        "This site features landscape photographs taken during my travels.",
    ],
    contactTitle: "Contact",
    contactPrompt: "Please contact me via Instagram DM.",
    updatesLine: "Content will be updated from time to time.",
    contactUrl: "https://www.instagram.com/maru_chaannn",
    contactHandle: "@maru_chaannn",
    photographer: {
        title: "Webmaster",
        name: "Ryuhei Maruta",
    },
};

export function getAboutContent(locale: "ja" | "en" = "ja"): AboutContent {
    return locale === "en" ? en : ja;
}

export default getAboutContent;
