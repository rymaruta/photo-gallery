// app/i18n/labels.ts

export type Labels = {
    site?: {
        title?: string;
        // subtitle を string | string[] に変更（段落配列を許容）
        subtitle?: string | string[];
    };
    ui?: {
        language?: {
            ja?: string;
            en?: string;
        };
    };
    category: {
        title: string;
        all: string;
        names?: Record<string, string>;
    };
    sort: {
        label: string;
        options: {
            new: string;
            old: string;
            popular: string;
            [key: string]: string;
        };
    };
    tags: {
        title: string;
        multiple?: string;
        single?: string;
        none?: string;
    };
    actions: {
        /** タグの選択解除ボタン。日本語UIなのに "Clear" が出ていたため必須にした */
        clearTags: string;
    };
    search: {
        placeholder: string;
        clear: string;
    };
    gallery?: {
        emptyMessage?: string;
        resultsCount?: string;
    };
    navigation?: {
        works?: string;
        gallery?: string;
        about?: string;
        favorites?: string;
        map?: string;
        mypage?: string;
        albums?: string;
        wishlist?: string;
        account?: string;
        upload?: string;
        profile?: string;
        admin?: string;
        login?: string;
        logout?: string;
        signup?: string;
    };
};

// 英語をデフォルトとして定義
const enLabels: Labels = {
    site: {
        title: "Works",
        // English subtitle も段落配列に揃える
        subtitle: [
            "A quiet place to appreciate the works.",
            "Please enjoy freely.",
        ],
    },
    ui: {
        language: { ja: "日本語", en: "English" },
    },
    category: {
        title: "Category",
        all: "All",
        names: {
            all: "All",
            photography: "Photography",
            illustration: "Illustration",
            design: "Design",
            nature: "Nature",
            landscape: "Landscape",
            architecture: "Architecture",
            street: "Street",
        },
    },
    sort: {
        label: "Sort",
        options: { new: "Newest", old: "Oldest", popular: "Popular" },
    },
    tags: { title: "Tags" },
    actions: { clearTags: "Clear" },
    search: { placeholder: "Search title or description", clear: "Clear" },
    gallery: {
        emptyMessage: "No photos found.",
        resultsCount: "Results",
    },
    navigation: {
        works: "Works",
        gallery: "Gallery",
        about: "About",
        favorites: "Liked Photos",
        map: "Map",
        mypage: "My Page",
        albums: "Shared Albums",
        wishlist: "Travel List",
        account: "Account",
        upload: "Upload",
        profile: "Profile",
        admin: "Manage",
        login: "Login",
        logout: "Logout",
        signup: "Sign up",
    },
};

// 日本語は英語をベースに、変更が必要な部分だけ上書き
export const ja: Labels = {
    ...enLabels,
    site: {
        title: "作品紹介",
        subtitle: [
            "作品と向き合うための静かな場です。",
            "ご自由にお楽しみください。",
        ],
    },
    category: {
        title: "カテゴリ",
        all: "すべて",
        names: {
            all: "すべて",
            photography: "写真",
            illustration: "イラスト",
            design: "デザイン",
            nature: "自然",
            landscape: "風景",
            architecture: "建築",
            street: "街"
        },
    },
    sort: {
        label: "並び替え",
        options: { new: "新しい順", old: "古い順", popular: "人気順" },
    },
    tags: { title: "タグ" },
    actions: { clearTags: "選択を解除" },
    search: { placeholder: "タイトルや説明で検索", clear: "クリア" },
    gallery: {
        emptyMessage: "該当する写真がありません。",
        resultsCount: "結果",
    },
    navigation: {
        works: "作品",
        gallery: "ギャラリー",
        about: "制作について",
        favorites: "いいねした写真",
        map: "撮影地マップ",
        mypage: "マイページ",
        albums: "共同アルバム",
        wishlist: "行きたいリスト",
        account: "アカウント",
        upload: "アップロード",
        profile: "プロフィール",
        admin: "管理",
        login: "ログイン",
        logout: "ログアウト",
        signup: "新規登録",
    },
};

export const en: Labels = enLabels;

const map: Record<string, Labels> = { ja, en };

export function getLabels(locale: "ja" | "en" = "ja"): Labels {
    // デフォルトは日本語
    return map[locale] ?? ja;
}

export default getLabels;
