// 多言語対応を簡単にするヘルパー関数

/**
 * デフォルトを英語として、日本語だけ追加する方式
 * これにより、英語を毎回書く必要がなくなります
 */
export function t(key: string, locale: "ja" | "en" = "en"): string {
    // 翻訳キーから言語に応じたテキストを取得
    // 日本語が定義されていない場合は英語を返す
    const translations: Record<string, { ja?: string; en: string }> = {
        // ナビゲーション
        "nav.works": { ja: "作品", en: "Works" },
        "nav.gallery": { ja: "ギャラリー", en: "Gallery" },
        "nav.about": { ja: "About", en: "About" },
        "nav.favorites": { ja: "お気に入り", en: "Favorites" },
        "nav.history": { ja: "履歴", en: "History" },
        "nav.upload": { ja: "アップロード", en: "Upload" },
        "nav.login": { ja: "ログイン", en: "Login" },
        "nav.logout": { ja: "ログアウト", en: "Logout" },
    };

    const translation = translations[key];
    if (!translation) {
        console.warn(`Translation key "${key}" not found`);
        return key;
    }

    return locale === "ja" ? (translation.ja || translation.en) : translation.en;
}

/**
 * より簡単な方法：英語をデフォルトとして、日本語だけを追加
 * 使用例: t("Works", "ja") => "作品", t("Works", "en") => "Works"
 */
export function simpleT(enText: string, locale: "ja" | "en" = "en"): string {
    const jaTranslations: Record<string, string> = {
        "Works": "作品",
        "Gallery": "ギャラリー",
        "About": "About",
        "Favorites": "お気に入り",
        "History": "履歴",
        "Upload": "アップロード",
        "Login": "ログイン",
        "Logout": "ログアウト",
    };

    if (locale === "ja" && jaTranslations[enText]) {
        return jaTranslations[enText];
    }

    return enText;
}
