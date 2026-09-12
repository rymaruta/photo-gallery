/**
 * 題と撮影地をどう並べるか（**決め方だけ**。つなぎ方は呼ぶ側）。
 *
 * 同じ判断が**2か所**にある:
 *   写真ページの `<title>`  `題｜撮影地`
 *   画像の `alt`           `題（撮影地）`
 *
 * **一度ずれた。** `2ba4394d` で `<title>` だけ「撮影地の方が題を含む回」を
 * 直したが、`alt` は片方向のままだったので、実ビルドに
 * **`alt="オペラ・ガルニエ（オペラ・ガルニエ（パリ））"` が19回**出ていた。
 * 台帳がいちばん多く記録している型（入口が2つあるのに片方しか直さない）を
 * 自分でやったので、**決め方をここ1つに置く**。
 *
 * 規則:
 *   撮影地が無い              → 題だけ
 *   題が撮影地を含む          → 題だけ（「山中湖の朝｜山中湖」を作らない）
 *   撮影地が題で始まる        → 撮影地だけ（題を丸ごと含むので何も失わない）
 *   それ以外                  → 両方
 *
 * **「撮影地が題を含む」ではなく「題で始まる」で見る。** 「海」は
 * 「茨城県 ひたちなか市 国営ひたち海浜公園」に含まれるが、撮影地が「海」で
 * 始まっていないので今までどおり両方出す（実データで確認）。
 *
 * **何も import しない**（写真ページと `photoAlt` の両方が読む）。
 */
export type TitlePlace =
    | { kind: "single"; text: string }
    | { kind: "both"; title: string; place: string };

export function titleWithPlace(title: string, place: string): TitlePlace {
    const t = (title ?? "").trim();
    const p = (place ?? "").trim();
    if (!p || t.includes(p)) return { kind: "single", text: t };
    // **題が空の場合もここで決まる**——`"パリ".startsWith("")` は真なので
    // 撮影地だけが返る。最初は `if (!t) return ...` を先に置いていたが、
    // **変異で落としても何も変わらなかった**（等価）。「守っているつもりの
    // 1行」は残さない。振る舞いは上の「題が無ければ撮影地だけ」が縛る
    if (p.startsWith(t)) return { kind: "single", text: p };
    return { kind: "both", title: t, place: p };
}
