import type { CSSProperties } from "react";

/**
 * ヘッダーの丸い押し面（探す・お知らせ・メニュー）。**3つとも箱を持たない**
 * （iOS: 44px の面・アイコン17px・線1.6。v1 は 22px・1.7）。以前メニューだけ `bg-surface` の四角い
 * 箱を持ち（その前は直書きの灰色寄りの黒で、owner に「なんでこれだけ色違うの？」
 * と言われた）、ベルだけ `rounded-md` だった。押したときの丸い面（白10%）だけ残す。
 ***寸法は px で固定する**——
 * 640px 未満は root が 14px なので、`w-11`（rem）だけだと 38.5px に縮む。
 * `minWidth`/`minHeight` で 44px を保つ。
 *
 * **キーボードの枠は白60%**（黒の地で約7.4:1）。白30%だと 2.47:1 で、部品の縁に
 * 要る 3:1 に届かない（ベルは以前ブラウザ標準の枠だったので、揃えると見えにくくなっていた）。
 */
export const HEADER_ICON_BTN = "relative inline-flex items-center justify-center w-11 h-11 rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
export const HEADER_ICON_BTN_STYLE: CSSProperties = {
    touchAction: "manipulation", WebkitTapHighlightColor: "transparent", minWidth: "44px", minHeight: "44px",
};
/**
 * **印は 17px・線 1.6**（2026-10-15・iOS v2 の `WebTheme.toolbarIconSize` にそろえる）。
 * iOS は 22pt semibold →「デカすぎる」（owner）→ 17pt regular（システムの標準）に下げた。
 * 押せる面は 44px のまま（見た目だけ小さくする）。
 */
export const HEADER_ICON_STYLE: CSSProperties = { width: 17, height: 17, strokeWidth: 1.6 };

/**
 * **お知らせとメニューを入れるガラスの丸い札**（iOS 26 のバーの右の項目と同じ形・板 `.glass`）。
 * 色と縁は `globals.css` の `.header-glass`。高さは中の押し面（44px）で決まる。
 * 未ログインのときはメニュー1つだけが入る（お知らせはログイン中だけ）。
 */
export const HEADER_GLASS = "header-glass inline-flex items-center rounded-full";
