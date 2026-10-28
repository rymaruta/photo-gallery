/**
 * **ストーリーの手書き2種（Yusei Magic・Yomogi）の宣言。このファイルは `import()` でしか読まない。**
 *
 * 読むのはストーリーの文字を描く所だけ（`useStoryFonts`——`StoryTextOverlay` と
 * 投稿の画面 `StoriesBar`）。以前はルートのレイアウトが全ページで読み、2書体ぶんの
 * `@font-face` の表（gzip 64KB）が**ストーリーの無いページでも**描画を止めていた。
 * 理由と測った数は `webFonts.ts` の冒頭。字の名前の写しは `globals.css` の `:root`。
 */
import { Yusei_Magic, Yomogi } from "next/font/google";

/**
 * **手書き2種**（ストーリーの文字だけで使う。owner の要望 2026-09-22
 * 「広告でよくある手書きのフォントも欲しい」「アオハルマーカー mini /
 * みぎかたあがり のフォントがいい」）。
 *
 * ⚠️ **名指しの2つはそのまま使えない。**
 *   - アオハルマーカーmini は**漢字を収録していない**（かな・英数字のみ）
 *   - みぎかたあがり は**漢字が69字だけ**
 *   どちらも文章に混ぜると「かなは手書き・漢字はゴシック」になる。
 *   さらに Web フォントはファイルを閲覧者全員へ配ることになるが、
 *   両方とも配布元（BOOTH）の規約に Web フォント可の明記が無い。
 *
 * そこで**見た目がいちばん近く、漢字を持ち、配ってよい**（SIL OFL）2つ:
 *   - `Yusei Magic`（油性マジック）＝マーカー書き
 *   - `Yomogi`（ヨモギ）＝ペンの走り書き
 *
 * **代償を抑える形**:
 *   - `preload: false`——全ページに `<link rel=preload>` を出さない。
 *     使うのはストーリーの文字だけで、ほとんどのページには1文字も無い
 *   - `display: "swap"`——落ちてくるまでは丸ゴシックで読める
 *   - `subsets` は**書かない**（次のコメント）。日本語は `unicode-range` で
 *     細かく割れて配られるので、**実際に落ちるのは使った字の範囲だけ**
 *
 * ⚠️ **`subsets` を書かない。** next/font が持つ一覧に `japanese` が無く
 * （`font-data.json` は cyrillic/greek-ext/latin/latin-ext だけ）、
 * `latin` と書くと**日本語の字が1つも入らない**。省くと全部の
 * `unicode-range` を取り込み、ブラウザは**使った範囲だけ**落とす。
 * 省くときは `preload: false` が要る（Next が止める）。
 *
 * ⚠️ **`fallback` も渡さない。** 渡すと next/font は**その並びを CSS 変数の
 * 中へ焼き込む**ので、`storyText.ts` の
 * `var(--font-marker),"Hiragino…",cursive` が実際にはこう展開される
 * （実ブラウザで `getComputedStyle` を読んで見つけた）:
 *
 *     "Yusei Magic",Hiragino Maru Gothic ProN,Hiragino Sans,sans-serif,
 *     "Hiragino Maru Gothic ProN","Hiragino Sans",cursive
 *      ^^^^^^^^^^ ここで総称ファミリに当たり、後ろ半分は永久に使われない
 *
 * 受け皿の並びは `storyText.ts` の1か所だけが持つ。渡さないと変数は
 * `"Yusei Magic","Yusei Magic Fallback"` になり、並びは `cursive` まで届く。
 *
 * ⚠️ **`adjustFontFallback: false` は効かない**（実ビルドで確かめた）。
 * 渡しても `@font-face{font-family:Yusei Magic Fallback;src:local(Arial);
 * size-adjust:111.71%}` は出て、変数にも入る。効かない指定は置かない。
 * 害は無い——この面は Arial なので**日本語の字を1つも持たず**、
 * CSS のフォント選択は字ごとに落ちるので、日本語は次の
 * `Hiragino Maru Gothic ProN` へ進む。
 */
export const marker = Yusei_Magic({
    weight: ["400"],
    display: "swap",
    preload: false,
    variable: "--font-marker",
});
export const scribble = Yomogi({
    weight: ["400"],
    display: "swap",
    preload: false,
    variable: "--font-scribble",
});
