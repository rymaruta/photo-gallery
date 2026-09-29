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
 */
export const CHIP_OFF = "bg-chip text-chip-text ring-1 ring-inset ring-line hover:bg-surface-2 hover:text-white";
export const CHIP_ON = "bg-primary text-ink font-semibold";
