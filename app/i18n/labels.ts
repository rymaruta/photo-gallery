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
        /**
         * `/search` の `<h1>`。
         *
         * **トップと同じ文にしない。** 以前は両方が `site.title`
         * （「みんなの旅の写真」）で、別の面なのに見出しで区別できなかった
         * ——読み上げでページを行き来する人には同じページに見える。
         * `/search` は `noindex` なので検索結果への影響は無いが、
         * 見出しは画面が何かを言う場所。
         */
        heading?: string;
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
        /** 保存した写真（ブックマーク）。いいねとは別の棚 */
        saves?: string;
        map?: string;
        mypage?: string;
        albums?: string;
        settings?: string;
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
            people: "People",
            animal: "Animal",
            food: "Food",
        },
    },
    sort: {
        label: "Sort",
        options: { new: "Newest", old: "Oldest", popular: "Popular" },
    },
    tags: { title: "Tags" },
    actions: { clearTags: "Clear" },
    search: { placeholder: "Search photos", clear: "Clear", heading: "Find photos" },
    gallery: {
        emptyMessage: "No photos found.",
        resultsCount: "Results",
    },
    navigation: {
        works: "Works",
        gallery: "Gallery",
        about: "About",
        favorites: "Liked Photos",
        saves: "Saved Photos",
        map: "Map",
        mypage: "My Page",
        albums: "Shared Albums",
        settings: "Settings",
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
        // トップの h1 と一言。owner の判断（2026-09-20）で「作品紹介／作品と向き合う
        // ための静かな場」をやめた——一人の作品集の看板で、いまは何人も投稿する
        // サイト。見出しはサイトの実態と検索語（旅の写真）を両方持つ語に
        title: "みんなの旅の写真",
        subtitle: [
            "ふらっと眺めて、気が向いたら、あなたの1枚も。",
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
            street: "街",
            people: "人物",
            animal: "動物",
            food: "食べ物"
        },
    },
    sort: {
        label: "並び替え",
        options: { new: "新しい順", old: "古い順", popular: "人気順" },
    },
    tags: { title: "タグ" },
    actions: { clearTags: "選択を解除" },
    search: { placeholder: "写真を検索（タイトル・説明・タグなど）", clear: "クリア", heading: "写真をさがす" },
    gallery: {
        emptyMessage: "該当する写真がありません。",
        resultsCount: "結果",
    },
    navigation: {
        works: "作品",
        gallery: "ギャラリー",
        about: "制作について",
        favorites: "いいねした写真",
        saves: "保存した写真",
        map: "撮影地マップ",
        mypage: "マイページ",
        albums: "共同アルバム",
        settings: "設定",
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
