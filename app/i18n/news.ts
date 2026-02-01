// app/i18n/news.ts
// お知らせ・更新履歴のコンテンツ（日付・タイトル・本文）

export type NewsItem = {
    date: string; // YYYY-MM-DD または表示用 "2025年1月"
    title: string;
    body: string;
};

function getNewsJa(): NewsItem[] {
    return [
        {
            date: "2025-11-08",
            title: "サイトを公開しました。",
            body: "写真ギャラリーサイトをオープンしました。旅行で撮影した風景写真を中心に、随時追加していきます。",
        },
        {
            date: "2026-01-30",
            title: "サイトの各種機能を追加しました。",
            body: "お気に入り機能、閲覧履歴機能、お知らせ機能などを追加しました。",
        },
    ];
}

function getNewsEn(): NewsItem[] {
    return [
        {
            date: "2025-11-08",
            title: "Site launched.",
            body: "The photo gallery site is now open. I'll be adding landscape photos from my travels over time.",
        },
        {
            date: "2026-01-30",
            title: "New features added.",
            body: "Favorites, viewing history, and news page have been added.",
        },
    ];
}

export function getNewsContent(locale: "ja" | "en" = "ja"): NewsItem[] {
    return locale === "en" ? getNewsEn() : getNewsJa();
}

export default getNewsContent;
