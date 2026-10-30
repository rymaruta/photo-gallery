import type { CSSProperties } from "react";

/**
 * **入力欄の形**（2026-10-30 束 0b C6・iOS の検索欄 `SearchView.searchField` と板 Components 01）。
 *
 *     高さ 44 以上・角 12（`rounded-field`）・地 surface-2（#161617）・白8%の縁（`ring-line`）
 *     印は 17・text-3・左から 14・印と字の間 10
 *
 * 以前は画面ごとに書いていて、丸い端（`rounded-full`）の欄・角 20／22 の欄・縁の無い白6%の欄・
 * 高さ 36／42／48 が混ざっていた。**字は Web だけ 16 のまま**——タッチ端末は `globals.css` が
 * 16 に上げる（iPhone の Safari は 16 未満の欄で画面を拡大して戻さない）。ここの 15 はマウスの画面の字。
 * 縁は `ring-inset`（外に描くと並びの隙間を 1px 食う）。キーボードの枠は真鍮 2px（黒地の上）。
 */
export const FIELD = "rounded-field bg-surface-2 ring-1 ring-inset ring-line text-white placeholder:text-white/50 outline-none focus-visible:ring-2 focus-visible:ring-accent focus:ring-white/20 transition";
/** 1行の欄の寸法（44・字 15・左右 14） */
export const FIELD_STYLE: CSSProperties = { minHeight: "44px", fontSize: "15px", paddingLeft: "14px", paddingRight: "14px" };

/** 検索欄（左に虫眼鏡・右に自前の ✕）。ブラウザの ✕ は消す（`search-own-clear`） */
export const SEARCH_FIELD = `search-own-clear w-full ${FIELD}`;
/** 検索欄の寸法: 左は 印14＋17＋間10＝41、右は ✕ の 40 */
export const SEARCH_FIELD_STYLE: CSSProperties = { minHeight: "44px", fontSize: "15px", paddingLeft: "41px", paddingRight: "40px" };
/** 検索欄の虫眼鏡（17・text-3・左から 14・縦の中央）。押せない飾り */
export const SEARCH_ICON = "pointer-events-none absolute left-[14px] top-1/2 -translate-y-1/2 text-text-3";
export const SEARCH_ICON_STYLE: CSSProperties = { width: 17, height: 17, strokeWidth: 1.6 };
