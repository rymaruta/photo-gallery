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
 * **寸法は持たない。** 大きさは画面ごとに意図して違う（タイムラインのタグは小さい）。
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
export const CHIP_ON = "bg-primary text-ink font-semibold ring-inset focus:outline-hidden focus:-outline-offset-2 focus-visible:ring-2 focus-visible:ring-ink";
