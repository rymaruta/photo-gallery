"use client";

import { useEffect } from "react";

/**
 * **Web フォントを、最初の描画のあとで読む**（2026-10-28）。
 *
 * next/font の CSS は日本語の `unicode-range` で割った `@font-face` が数百個あり、
 * 1書体で gzip 約 32KB。ルートのレイアウトが3書体を直に読んでいた頃は、これが
 * 全ページの `<head>` で**描画を止めるスタイルシート**になっていた（PageSpeed Insights・
 * スマホ: 描画を止めるリクエストで 3,450ms、FCP 5.8秒）。理由と測った数は
 * `app/fonts/webFonts.ts` の冒頭。
 *
 * `import()` すると、その CSS は**描画を止めない別のチャンク**として届く。
 * 届くまでは `globals.css` の `:root` が持つ既定の並び（字の名前の写し）で描き、
 * 字の表が無いあいだは端末の明朝・丸ゴシックに落ちる（`display: swap` で
 * 字が届くまでの間と同じ見た目）。届いたら next/font の変数のクラスを `<body>` に
 * 付け、next/font が名乗る正式な値で上書きする（写しがずれても字は当たる）。
 *
 * JS が動かない環境では Web フォントは来ない（端末の字のまま）。読めなかった
 * ときも何もしない——字が無くても読めるので、画面を壊す理由にしない。
 */
type FontLike = { variable?: string } | undefined;

function addVariables(fonts: FontLike[]): void {
    for (const f of fonts) {
        const names = (f?.variable ?? "").split(/\s+/).filter(Boolean);
        if (names.length) document.body.classList.add(...names);
    }
}

/** 見出しの明朝。全ページで、水和のあとに1回 */
export default function WebFontLoader() {
    useEffect(() => {
        import("../fonts/webFonts")
            .then(({ mincho }) => addVariables([mincho]))
            .catch(() => { /* 字が無くても読める */ });
    }, []);
    return null;
}

let storyFonts: Promise<void> | null = null;

/**
 * ストーリーの手書き2種（Yusei Magic・Yomogi）。**ストーリーの文字を描く所だけ**が呼ぶ
 * （`StoryTextOverlay`・投稿の画面 `StoriesBar`）。何度呼んでも読むのは1回
 */
export function loadStoryFonts(): Promise<void> {
    if (!storyFonts) {
        storyFonts = import("../fonts/storyFonts")
            .then(({ marker, scribble }) => addVariables([marker, scribble]))
            .catch(() => { storyFonts = null; /* 次に描くときにもう一度 */ });
    }
    return storyFonts;
}

export function useStoryFonts(): void {
    useEffect(() => { void loadStoryFonts(); }, []);
}

/** 描いた所で手書き2種を読むだけの部品（ストーリーを作る画面の字体の欄に置く） */
export function StoryFontsLoader(): null {
    useStoryFonts();
    return null;
}
