/**
 * **選んでいるタブは真鍮**（2026-10-15・iOS のデザイン v2 にそろえる）。
 *
 * owner の好み（2026-09-29「デザインの箇所は白より真鍮色が好き」・iOS の CLAUDE.md）で、
 * iOS は下のタブバーの選んでいる札を真鍮にしてある（`TabBarStyle.swift`）。Web も同じにする。
 * 以前は白（ホームのタブは白の下線・マイページのタブはその人のテーマ色の線）だった。
 *
 * 🔴 **色だけで状態を伝えない**（WCAG 1.4.1）。真鍮と選んでいない灰は明るさが近い
 * （#C9A66B と白60%）ので、**太字と 2px の下線**も必ず付ける。下のタブバーは下線の代わりに
 * 塗りつぶしの絵・太字・丸い面で示す（`BottomNav.tsx`）。
 *
 * **真鍮は黒い地の上だけ**——この3つのタブはどれも黒地（または黒の札）の上にある。
 * 下のタブバーは写真が透けるガラスなので、そちらの比は `BottomNav.test.tsx` が測る。
 *
 * 下線は `box-shadow` の内側で描く（`inset 0 -2px 0`）。`border-b-2` だと選ぶたびに
 * 字の位置が 2px 動く。**px で書く**——以前は 640px 未満の root が 14px で `h-0.5` が 1.75px になっていた（2026-10-30 束 0a で外した）。
 */
export const TAB_ON = "text-accent font-semibold shadow-[inset_0_-2px_0_var(--color-accent)]";
/**
 * 選んでいないタブ（`text-3` #9A9A9A＝黒の上で 7.46:1・iOS の `GalleryView` の札と同じ色）。
 * 2026-10-30 判断（束 0b C4）: 以前は白60%・細字。iOS は選んでいない札も 15 semibold
 * （`JPFont.bodyEmphasis`）で、選んだ札との違いは色（真鍮）と下線で見せる
 */
export const TAB_OFF = "text-text-3 hover:text-white";
/**
 * タブの字（iOS `JPFont.bodyEmphasis`: 15・semibold）と押せる高さ 44。選んでいる・いないで太さを変えない
 * （変えると選ぶたびに字の幅が動き、並びが揺れる）。並びは名前の幅で左から、間 24（人のページは 22）・
 * 下に白8%の線（`TAB_ROW`）
 */
export const TAB_BASE = "inline-flex items-center min-h-[44px] px-0 text-[15px] leading-[20px] font-semibold whitespace-nowrap transition-colors";
/** タブの並び（名前の幅で左から・間 24・下に白8%の線）。人のページだけ間 22 を足して上書きしない——別の並びを持つ */
export const TAB_ROW = "flex items-stretch gap-[24px] border-b border-line";
