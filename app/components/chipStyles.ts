/**
 * 押せるチップ（絞り込み・タグ・県・機材）の色。**iOS のデザインシステム「黒塗りの真鍮」に揃える**
 * （`docs/ios-alignment-2026-09-27.md` §3）。
 *
 *   選んでいない  白7%（`bg-chip`）＋ 白8%の縁（`ring-line`）＋ `#D4D4D4`（`text-chip-text`）
 *   選んでいる    白94%（`bg-primary`・#F0F0F0）＋ 墨（`text-ink`）・600
 * （v2・2026-10-15。v1 は #1A1A1A＋白12%の縁・選択は白92%）
 *
 * 以前は画面ごとに書いていて、絞り込み（`FilterBar`）だけ旧い「白7%・縁なし・白70%」、
 * スポットの一覧などは色だけ合って縁が無い、とばらばらだった。
 *
 * **寸法は `CHIP_SIZE`**（v2: 高さ 34・字 13・左右 14。2026-10-15）。一覧の中の小さなタグ
 * （写真ページ・タイムライン）は画面ごとの寸法のまま——`CHIP_OFF`/`CHIP_ON` は色だけを持つ。
 * 縁は `ring-inset` で内側に描く（外に描くと並びの隙間が 1px ずつ詰まる）。
 * **キーボードの輪も定数が持つ**（画面ごとに書くと、選択中と非選択で色を分けられない）。
 * どちらも**内側の 2px**——外側に描くと、横スクロールの行（縦の余白なし）で上下が切れる
 * （選択中の輪が左右の端しか見えなかった・レビューの実測）。
 *   非選択  真鍮（チップの地 白7%＝黒の上で #121212 に対して 8.16:1）
 *   選択中  墨（白い地 #F0F0F0 に対して 17.5:1。真鍮だと 2.01:1 で見えない）
 * **ブラウザ既定の輪（outline）は消す**。消さない画面では外に白・内に真鍮の二重の輪になっていた
 * （タイムライン・写真ページ・探すの機材・スポット一覧）。
 * 🔴 **`outline-none` ではなく `outline-hidden`。** 輪は box-shadow なので、Windows のハイコントラスト
 * （forced-colors）では描かれない。`outline-none` だとフォーカスの印が何も残らない。
 * `outline-hidden` は普段は同じく消え、forced-colors のときだけ透明の outline を系統色で描く。
 * その outline は既定で外側（offset 2px）なので、横スクロールの行（縦の余白なし）で上下が切れる
 * ——`-outline-offset-2` で内側に寄せる（生成順で outline-hidden より後に並ぶので勝つ）。
 * ⚠️ **使う側で `focus:outline-none` を足さない。** 後に並ぶので forced-colors の outline を消す
 * （`chipStyles.test.ts` が、定数と別名 `CHIP_CLASS` を使う行の前後3行を見ている。
 *  `focus-visible:outline-none`・`outline-0`・offset の上書きも同じく落とす）
 *
 * **カーソルを乗せたら `bg-white/15`。** 以前の `hover:bg-surface-2` は `bg-chip` と同じ値
 * で何も変わっていなかった（v1 で `globals.css` の2つのトークンが同じ値だった）。
 *
 * ⚠️ **`CHIP_ON` は `bg-primary` のままにする。** `app/__tests__/textContrast.test.ts` が
 * `CHIP_ON` を「明るい塗り」として数え、その上に白い文字が無いかを見ている。
 */
export const CHIP_OFF = "bg-chip text-chip-text ring-1 ring-inset ring-line hover:bg-white/15 hover:text-white focus:outline-hidden focus:-outline-offset-2 focus-visible:ring-2 focus-visible:ring-accent";
export const CHIP_ON = "chip-check bg-primary text-ink font-semibold ring-inset focus:outline-hidden focus:-outline-offset-2 focus-visible:ring-2 focus-visible:ring-ink";

/**
 * **押せるチップの寸法（v2 の板 `.chip`: 高さ 34・字 13・左右 14）。** iOS も同じ値。
 * **style で渡す**——以前は 640px 未満の root が 14px で、rem の `h-*`・`text-sm` が縮んでいた（2026-10-30 束 0a で外した）。
 * 件数の小さな字も 12px 以上（本文系の最小）。
 */
export const CHIP_SIZE = { fontSize: "13px", lineHeight: "18px", padding: "7px 14px", minHeight: "34px", minWidth: "44px" } as const;

/**
 * **選んだチップの ✓**（2026-10-30 束 0b C5・iOS の `PillChip`: 選ぶと白の塗り＋チェックの形）。
 * 色だけで選んだことを伝えない。印は `CHIP_ON` が付ける `chip-check`（`globals.css`）が `::after` で描き、
 * `order: -1` で字の前に出す——**チップは flex か inline-flex で組むこと**（そうでないと字の後ろに出る）。
 * 読み上げは `aria-pressed`／`aria-checked`／`aria-selected` が伝えるので、印は飾り（擬似要素は読まれない）。
 *
 * **押せるチップの当たり**（2026-10-11 `SpotTopicLists` から移した）。見た目は 34px のまま、
 * **上下 5px ずつ外へ当たりを広げて 44px**（iOS の `PillChip.tapSlack`）。並びの縦の隙間は 10px（`CHIP_ROW`）にして、
 * となりの行の当たりと重ねない。**横に流す並び（overflow-x）では、並びに上下 5px の余白を持たせる**
 * （無いと当たりがはみ出して縦に揺れる・`FilterBar` の `WRAPPING_ROW`）。
 * 本文の板の値は 34（DesignSystem 03・iOS `PillChip.height`）。比較の板 C5 の「36」は iOS の実装と食い違うので 34 を取った
 */
export const CHIP_HIT = "relative before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-['']";
/** 折り返すチップの並び（横 6・縦 10＝当たり 44 が重ならない） */
export const CHIP_ROW = "flex flex-wrap gap-x-1.5 gap-y-2.5 m-0 p-0";
