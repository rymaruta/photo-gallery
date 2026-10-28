// lib/utils/headingFont.ts
//
// **大見出し（h1）の明朝の並び**（2026-10-21・板 DesignSystem 02「WEB h1 だけ Shippori 700 を自己ホスト」）。
//
// 先頭は見出しの明朝（Shippori Mincho B1 Bold）。`--font-mincho` は `app/fonts/webFonts.ts` の next/font が
// 立てる変数（水和のあとで `WebFontLoader` が読む・届くまでは `globals.css` の `:root` の既定値）で、字のファイルは**このサイト自身から**配る（Google へ閲覧者の通信は出ない）。
// 太さ 700 だけ・`unicode-range` で細かく割れた woff2・`font-display: swap`——ページで使った字の
// 範囲だけが落ち、落ちるまでは後ろの端末の明朝（`MINCHO_STACK`）で読める。字は SIL OFL 1.1（表示はフッター）。
//
// ⚠️ **`MINCHO_STACK` そのものには足さない。** あれは `api-user/src/storyText.ts` の写し
// （`scripts/__tests__/storyTextParity.test.ts` が2本の一致を縛る）で、ストーリーの文字の「明朝」
// （太さ 600）も同じ値を使う。足すとサーバーの写しとずれ、ストーリーの明朝の見た目も変わる。

import { MINCHO_STACK } from "./storyText";

export const DISPLAY_MINCHO_STACK = `var(--font-mincho),${MINCHO_STACK}`;
