/**
 * **ボタンの寸法（v2 の板 Components 01: 高さは 50（主）と 44（副）の2種類だけ）**（2026-10-15）。
 * iOS の `JPHeight.primaryButton`（50）・`secondaryButton`（44）と同じ値。
 *
 * **色は持たない**——写真の無い画面の主ボタンは真鍮の塗り（`bg-accent-fill text-ink`）、
 * 写真のある画面の主ボタンは白（`bg-primary text-ink`）で、どちらを使うかは画面が決める
 * （iOS の CLAUDE.md・owner の好み）。
 *
 * **px で書く**——640px 未満は root が 14px なので、`py-3`・`text-sm` は縮む
 * （以前の主ボタンは `py-3`＋`text-sm` で 640px 未満だと約 41px しか無かった）。
 */
/** 塗りの主ボタン（1画面に1つ）。高さ 50・字 16・600・丸 */
export const BTN_FILL = "min-h-[50px] px-[24px] text-[16px] font-semibold rounded-full";
/**
 * 線の副ボタン。高さ 44・字 15・600・白14%の縁（`line-strong`）・丸。
 * 押せることは字で分かるので、縁は 3:1 を要しない（iOS の `WebTheme.line` の注記）
 */
export const BTN_LINE = "min-h-[44px] px-[20px] text-[15px] font-semibold rounded-full ring-1 ring-inset ring-line-strong text-white";
