// 簡易版：英語をデフォルトとして、日本語だけを追加する方式
// これにより、英語を毎回書く必要がなくなります

type SimpleLabels = {
    [key: string]: string | { ja?: string; en: string };
};

// 英語をデフォルトとして、日本語だけを追加
const translations: SimpleLabels = {
    // ナビゲーション
    "nav.works": { en: "Works", ja: "作品" },
    "nav.gallery": { en: "Gallery", ja: "ギャラリー" },
    "nav.about": { en: "About" }, // 日本語が同じ場合は省略可能
    "nav.favorites": { en: "Favorites", ja: "お気に入り" },
    "nav.history": { en: "History", ja: "履歴" },
    "nav.upload": { en: "Upload", ja: "アップロード" },
    "nav.login": { en: "Login", ja: "ログイン" },
    "nav.logout": { en: "Logout", ja: "ログアウト" },
};

export function getSimpleLabel(key: string, locale: "ja" | "en" = "en"): string {
    const translation = translations[key];
    
    if (!translation) {
        console.warn(`Translation key "${key}" not found`);
        return key;
    }

    if (typeof translation === "string") {
        return translation;
    }

    // 日本語が定義されていない場合は英語を返す
    return locale === "ja" ? (translation.ja || translation.en) : translation.en;
}
