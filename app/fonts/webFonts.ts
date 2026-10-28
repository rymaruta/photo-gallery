/**
 * **見出しの明朝（Shippori Mincho B1）の宣言。このファイルは `import()` でしか読まない。**
 * 手書き2種（ストーリーの文字だけ）は `storyFonts.ts`。
 *
 * 🔴 **静的に import しない（2026-10-28・スマホの FCP 5.8秒／LCP 8.8秒）。**
 * 以前はルートのレイアウトが3書体を直に持っていて、next/font が作る CSS
 * （日本語の `unicode-range` で割った `@font-face` が数百個）が**全ページの
 * `<head>` に描画を止める `<link rel="stylesheet">` として3本**並んでいた。
 * 本番のトップで測った大きさ（gzip）:
 *
 *     Tailwind の本体          18 KB
 *     Shippori Mincho B1       32 KB   ← 見出し・撮影地
 *     Yusei Magic              32 KB   ← ストーリーの文字だけ
 *     Yomogi                   32 KB   ← 同上
 *
 * 字そのもの（woff2）は `display: swap` で後から来るのに、**その置き場所を書いた
 * 表**のために最初の描画が 96KB 待たされていた。いまは `WebFontLoader` が水和の
 * あとで `import()` する＝ CSS は描画を止めない別のチャンクになる。
 * 届くまでは `globals.css` の並びの次（端末の明朝）で描く
 * ——`display: swap` で字が届くまでの間と同じ見た目。
 *
 * ⚠️ **字の名前は `globals.css` の `:root` に写しがある**（届く前から
 * `var(--font-mincho)` を有効にしておくため）。届いたら `WebFontLoader` が
 * 下の `variable` のクラスを `<body>` に付け、next/font が名乗る正式な値で上書きする。
 * 突き合わせは `app/__tests__/webFontsDeferred.test.tsx`。
 */
import { Shippori_Mincho_B1 } from "next/font/google";

/**
 * **見出しの明朝（Shippori Mincho B1 Bold）——アプリ v2 と同じ字（2026-10-15）。**
 *
 * iOS は `JPFont.display`（写真の題・画面の題・名前）でこの字を同梱している。
 * Web の `font-serif`（31か所・見出しだけ）は端末の明朝任せで、iPhone では
 * ヒラギノ明朝、Windows では游明朝と、**アプリと別の字**になっていた。
 *
 * **本文の Inter はやめた。** Inter は日本語の字を持たず、ほぼ日本語の本文には
 * 当たっていなかった（英数字だけ Inter・日本語は端末の字で割れていた）。
 * iOS の本文はシステムの字（SF Pro＋ヒラギノ角ゴ）なので、Web も
 * `globals.css` の `--font-sans`（`-apple-system` から始まる並び）にそろえる。
 * Inter の webfont を全ページに配っていたぶん、配る量は減る。
 *
 * **配る量を抑える形**（手書き2種と同じ。理由は下の docstring）:
 *   - 太さは **700 の1つだけ**（アプリも Bold だけ）
 *   - `subsets` を書かない＝日本語の `unicode-range` を全部持ち、**ブラウザは
 *     そのページで使った字の範囲だけ**落とす
 *   - `preload: false`——見出しの無いページに先読みを出さない
 *   - `display: "swap"`——落ちてくるまでは端末の明朝で読める
 *   - `fallback` を渡さない——並びは `globals.css` の `--font-serif` だけが持つ
 *
 * 字は SIL OFL（配ってよい）。ファイルは next/font がビルド時に取り込み、
 * **このサイト自身から配る**（Google へ閲覧者の通信は出ない）。
 */
export const mincho = Shippori_Mincho_B1({
    weight: ["700"],
    display: "swap",
    preload: false,
    variable: "--font-mincho",
});
