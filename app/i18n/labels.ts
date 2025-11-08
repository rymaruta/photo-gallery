// app/i18n/labels.ts
export type Labels = {
    category: {
        title: string;
        all: string;
        // map of category key -> display name (optional)
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
};

export const ja: Labels = {
    category: {
        title: "カテゴリ",
        all: "すべて",
        names: {
            all: "すべて",
            photography: "写真",
            illustration: "イラスト",
            design: "デザイン",
        },
    },
    sort: {
        label: "並び替え",
        options: {
            new: "新しい順",
            old: "古い順",
            popular: "人気順",
        },
    },
    tags: {
        title: "タグ",
    },
    search: {
        placeholder: "タイトルや説明で検索",
        clear: "クリア",
    },
};

export const en: Labels = {
    category: {
        title: "Category",
        all: "All",
        names: {
            all: "All",
            photography: "Photography",
            illustration: "Illustration",
            design: "Design",
        },
    },
    sort: {
        label: "Sort",
        options: {
            new: "Newest",
            old: "Oldest",
            popular: "Popular",
        },
    },
    tags: {
        title: "Tags",
    },
    search: {
        placeholder: "Search title or description",
        clear: "Clear",
    },
};

// simple selector. defaultLocale can be changed easily.
const map: Record<string, Labels> = { ja, en };

export function getLabels(locale: string = "ja"): Labels {
    return map[locale] ?? ja;
}

export default getLabels;
