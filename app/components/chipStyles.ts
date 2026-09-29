/**
 * 押せるチップ（絞り込み・タグ・県・機材）の色。**iOS のデザインシステム「黒塗りの真鍮」に揃える**
 * （`docs/ios-alignment-2026-09-27.md` §3）。
 *
 *   選んでいない  `#1A1A1A`（`bg-chip`）＋ 白12%の縁（`ring-line`）＋ `#D4D4D4`（`text-chip-text`）
 *   選んでいる    `#EBEBEB`（`bg-primary`）＋ 墨（`text-ink`）・600
 *
 * 以前は画面ごとに書いていて、絞り込み（`FilterBar`）だけ旧い「白7%・縁なし・白70%」、
 * スポットの一覧などは色だけ合って縁が無い、とばらばらだった。
 *
 * **寸法は持たない。** 大きさは画面ごとに意図して違う（タイムラインのタグは小さい）。
 * 縁は `ring-inset` で内側に描く（外に描くと並びの隙間が 1px ずつ詰まる）。
 * **キーボードの輪も定数が持つ**（画面ごとに書くと、選択中と非選択で色を分けられない）。
 * どちらも**内側の 2px**——外側に描くと、横スクロールの行（縦の余白なし）で上下が切れる
 * （選択中の輪が左右の端しか見えなかった・レビューの実測）。
 *   非選択  真鍮（チップの地 #1A1A1A に対して 7.58:1）
 *   選択中  墨（白い地 #EBEBEB に対して 16.74:1。真鍮だと 1.93:1 で見えない）
 *
 * **カーソルを乗せたら `bg-white/15`。** `hover:bg-surface-2` は `bg-chip` と同じ `#1a1a1a`
 * で何も変わっていなかった（`globals.css` の2つのトークンが同じ値）。
 *
 * ⚠️ **`CHIP_ON` は `bg-primary` のままにする。** `app/__tests__/textContrast.test.ts` が
 * `CHIP_ON` を「明るい塗り」として数え、その上に白い文字が無いかを見ている。
 */
export const CHIP_OFF = "bg-chip text-chip-text ring-1 ring-inset ring-line hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-accent";
export const CHIP_ON = "bg-primary text-ink font-semibold ring-inset focus-visible:ring-2 focus-visible:ring-ink";
