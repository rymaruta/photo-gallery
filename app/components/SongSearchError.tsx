"use client";

import { useLocale } from "../i18n/context";

/**
 * 曲検索が失敗したときの一行。
 *
 * **`role="alert"` を付ける。** これは「探す」を押した直後に出る
 * 一時的な手応えで、読み上げ環境では**押しても何も起きなかったように
 * 見えて**いた（WCAG 4.1.3 状態メッセージ）。ストーリーの
 * `StoryViewer.tsx` の `keepError` は `role="alert"` を持っており、
 * **同じ機能の中で扱いが割れていた**（曲検索の失敗は `StoriesBar.tsx` 側）。
 *
 * **見た目は変えていない**（`role` は描画に出ない属性）。
 *
 * **3か所に同じ文面・同じマークアップで書かれていた**ので1つにまとめる
 * ——ストーリーの曲・写真ページのBGM・プロフィールのBGM。探す仕組み自体は
 * 既に `lib/hooks/useSongSearch.ts` に1本化してあり、**文言だけが
 * 複製のまま**だった。
 */
export default function SongSearchError() {
    const { locale } = useLocale();
    return (
        <p className="text-xs text-amber-400/80" role="alert">
            {locale === "en" ? "Search failed. Try again." : "検索に失敗しました。もう一度お試しください。"}
        </p>
    );
}
