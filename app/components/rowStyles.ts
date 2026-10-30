/**
 * **札と行**（2026-10-30 束 0b C11・iOS の `JPCard`／`jpCardFace` と行の値・板 Components 05）。
 *
 *     札   地 #0E0E0F（surface）・白8%の縁（`ring-line`）・角 16（`rounded-2xl`＝iOS `JPRadius.l`）
 *     行   高さ 56（二行の行も 56 以上・人の行は 64）・左右 16・間 12
 *          左に印（28 の箱に 18 の線の印・text-3）→ 題 15 semibold → 副 12 text-2 → 右に ›（text-3）
 *     行と行の間は白8%の線（`divide-line`）
 *
 * 以前は画面ごとに書いていて、案内の帯は 44・角 10.5（束 0a で 14）・字 14 の文字だけ、近くの撮影スポットの行は
 * 54・縁なしの地だった。**黒地の上の札だけ**（写真の上には置かない）。
 */
export const CARD = "rounded-2xl bg-surface ring-1 ring-inset ring-line overflow-hidden";
/** 札の中の行の並び（行の間に白8%の線） */
export const CARD_LIST = `m-0 p-0 ${CARD} divide-y divide-line`;
/** 1行（札の中に置く）。押せる行は Link／button にこれを付ける */
export const ROW = "flex items-center gap-3 px-4 min-h-[56px] text-white hover:bg-white/5 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
/** 1行だけの札（行そのものが札の面を持つ） */
export const ROW_CARD = `${ROW} ${CARD}`;
/** 二行の行・人の行の高さ */
export const ROW_TALL = "min-h-[64px]";
/** 左の印の箱（28）。中の印は `ROW_ICON` */
export const ROW_ICON_BOX = "flex-shrink-0 inline-flex items-center justify-center w-[28px] h-[28px] text-text-3";
export const ROW_ICON = "w-[18px] h-[18px]";
/** 題（15 semibold・1行） */
export const ROW_TITLE = "block truncate text-white text-[15px] leading-[20px] font-semibold";
/** 副（12・text-2・1行） */
export const ROW_SUB = "block truncate text-text-2 text-[12px] leading-[16px]";
/** 右の値（距離など・13・text-3・等幅数字） */
export const ROW_VALUE = "flex-shrink-0 text-text-3 text-[13px] tabular-nums";
/** 右の ›（text-3・14） */
export const ROW_CHEVRON = "flex-shrink-0 w-[14px] h-[14px] text-text-3";
