/**
 * **ボタンの寸法（v2 の板 Components 01: 高さは 50（主）と 44（副）の2種類だけ）**（2026-10-15）。
 * iOS の `JPHeight.primaryButton`（50）・`secondaryButton`（44）と同じ値。
 *
 * **色は持たない**——写真の無い画面の主ボタンは真鍮の塗り（`bg-accent-fill text-ink`）、
 * 写真のある画面の主ボタンは白（`bg-primary text-ink`）で、どちらを使うかは画面が決める
 * （iOS の CLAUDE.md・owner の好み）。
 *
 * **px で書く**——以前は 640px 未満の root が 14px で、`py-3`・`text-sm` が縮んでいた（2026-10-30 束 0a で外した）
 * （以前の主ボタンは `py-3`＋`text-sm` で 640px 未満だと約 41px しか無かった）。
 */
/** 塗りの主ボタン（1画面に1つ）。高さ 50・字 16・600・丸 */
export const BTN_FILL = "min-h-[50px] px-[24px] text-[16px] font-semibold rounded-full";
/**
 * 線の副ボタン。高さ 44・字 15・600・白14%の縁（`line-strong`）・丸。
 * 押せることは字で分かるので、縁は 3:1 を要しない（iOS の `WebTheme.line` の注記）
 */
export const BTN_LINE = "min-h-[44px] px-[20px] text-[15px] font-semibold rounded-full ring-1 ring-inset ring-line-strong text-white";

/**
 * **行の中の小ボタン（フォロー）**（2026-10-30 束 0b C8・iOS の `FollowPill`・板 DesignSystem 03）。
 * 見た目 36・13 semibold・左右 14・幅 44 以上。**当たりは上下 4 ずつ広げて 44**（`before:`）。
 * 以前は画面ごとに形が割れていた（写真の詳細＝真鍮の線と字・人の印つき 36、人のページ＝白塗り 44、
 * お知らせ＝32）。印（人の絵・✓）は付けない——iOS も字だけ。
 */
export const INLINE_BTN = "relative inline-flex items-center justify-center rounded-full font-semibold whitespace-nowrap before:absolute before:inset-x-0 before:-inset-y-[4px] before:content-[''] transition active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
export const INLINE_BTN_STYLE = { minHeight: "36px", minWidth: "44px", fontSize: "13px", lineHeight: "18px", paddingLeft: "14px", paddingRight: "14px" } as const;
/** まだフォローしていない: 白 94% の塗り＋墨 */
export const FOLLOW_OFF = "bg-primary text-ink hover:brightness-110";
/** フォロー中: 白12% の地・白の字・白18% の縁 */
export const FOLLOW_ON = "bg-white/12 text-white ring-1 ring-inset ring-white/18 hover:bg-white/20";
