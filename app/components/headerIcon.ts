import type { CSSProperties } from "react";

/**
 * ヘッダーの丸い押し面（探す・お知らせ・メニュー）。**3つとも箱を持たない**
 * （iOS: 44px の面・アイコン22px・線1.7）。以前メニューだけ `bg-surface` の四角い
 * 箱を持ち（その前は直書きの灰色寄りの黒で、owner に「なんでこれだけ色違うの？」
 * と言われた）、ベルだけ `rounded-md` だった。押したときの丸い面（白10%）だけ残す。
 ***寸法は px で固定する**——
 * 640px 未満は root が 14px なので、`w-11`（rem）だけだと 38.5px に縮む。
 * `minWidth`/`minHeight` で 44px を保つ。
 */
export const HEADER_ICON_BTN = "relative inline-flex items-center justify-center w-11 h-11 rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30";
export const HEADER_ICON_BTN_STYLE: CSSProperties = {
    touchAction: "manipulation", WebkitTapHighlightColor: "transparent", minWidth: "44px", minHeight: "44px",
};
export const HEADER_ICON_STYLE: CSSProperties = { width: 22, height: 22, strokeWidth: 1.7 };
