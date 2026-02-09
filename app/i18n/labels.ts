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
    };
    search: {
        placeholder: string;
        clear: string;
    };
    gallery?: {
        emptyMessage?: string;
        resultsCount?: string;
        /** ページネーション: 表示範囲 e.g. "1-10 of 21" / "1-10 件目（全 21 件）" */
        pageRange?: string;
        /** 前のページ */
        prevPage?: string;
        /** 次のページ */
        nextPage?: string;
        /** "もっと見る" ボタン（ページネーション未使用時用） */
        loadMore?: string;
        /** 残り件数表示 e.g. "残り {{count}} 件" / "{{count}} more" */
        loadMoreRemaining?: string;
    };
    navigation?: {
        works?: string;
        gallery?: string;
        about?: string;
        favorites?: string;
        history?: string;
        news?: string;
        upload?: string;
        admin?: string;
        login?: string;
        logout?: string;
    };
    /** 404 ページ */
    notFound?: {
        title?: string;
        description?: string;
        navLabel?: string;
        top?: string;
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
        },
    },
    sort: {
        label: "Sort",
        options: { new: "Newest", old: "Oldest", popular: "Popular" },
    },
    tags: { title: "Tags" },
    search: { placeholder: "Search title or description", clear: "Clear" },
    gallery: {
        emptyMessage: "No photos found.",
        resultsCount: "Results",
        pageRange: "{{from}}-{{to}} of {{total}}",
        prevPage: "Previous",
        nextPage: "Next",
        loadMore: "Load more",
        loadMoreRemaining: "{{count}} more",
    },
    navigation: {
        works: "Works",
        gallery: "Gallery",
        about: "About",
        favorites: "Favorites",
        history: "History",
        news: "News",
        upload: "Upload",
        admin: "Manage",
        login: "Login",
        logout: "Logout",
    },
    notFound: {
        title: "Page not found",
        description: "The page you're looking for doesn't exist or may have been moved.",
        navLabel: "Navigation",
        top: "Back to top",
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
    search: { placeholder: "タイトルや説明で検索", clear: "クリア" },
    gallery: {
        emptyMessage: "該当する写真がありません。",
        resultsCount: "結果",
        pageRange: "{{from}}-{{to}} 件目（全 {{total}} 件）",
        prevPage: "前へ",
        nextPage: "次へ",
        loadMore: "もっと見る",
        loadMoreRemaining: "残り {{count}} 件",
    },
    navigation: {
        works: "作品",
        gallery: "ギャラリー",
        about: "制作について",
        favorites: "お気に入り",
        history: "閲覧履歴",
        news: "お知らせ",
        upload: "アップロード",
        admin: "管理",
        login: "ログイン",
        logout: "ログアウト",
    },
    notFound: {
        title: "ページが見つかりません",
        description: "お探しのページは存在しないか、移動した可能性があります。",
        navLabel: "ナビゲーション",
        top: "トップへ",
    },
};

export const en: Labels = enLabels;

const map: Record<string, Labels> = { ja, en };

export function getLabels(locale: "ja" | "en" = "ja"): Labels {
    // デフォルトは日本語
    return map[locale] ?? ja;
}

export default getLabels;
