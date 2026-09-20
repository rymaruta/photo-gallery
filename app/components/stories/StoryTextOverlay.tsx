"use client";

import React from "react";
import {
    STORY_FONTS, STORY_COLORS, STORY_SIZES,
    type StoryTextStyle,
} from "@/lib/utils/storyText";
import type { MediaBox } from "@/lib/hooks/useMediaBox";

/**
 * ストーリーに載せた文字を描く。
 *
 * **見る側と、置いている最中の下書きが同じものを使う。** 別々に書くと
 * 「置いた場所と出る場所が違う」になり、置き直しても直らない
 * （このリポジトリが何度も踏んでいる「規則を2か所に書く」型）。
 *
 * 大きさは**絵の幅に対する割合**。px で持つと、撮った端末と見る端末で
 * 別の大きさになる。
 */
export default function StoryTextOverlay({ text, style, box, dimmed }: {
    text: string;
    style: StoryTextStyle;
    /** 絵が実際に描かれている矩形。測れていなければ囲み全体に載せる */
    box: MediaBox | null;
    /** 掴んでいる間などに少し透かす（下の写真を確かめられるように） */
    dimmed?: boolean;
}) {
    const font = STORY_FONTS[style.font];
    const color = STORY_COLORS[style.color];
    // 測れていないときは囲み全体（文字を消さない）。**幅が取れないと
    // 文字の大きさも決められない**ので、そのときだけ vw で置く
    // **スクリム（上下の黒いグラデーション）より上に出す。** 下に置くと
    // 白い文字が灰色に沈む（実測: 下書きの画面で文字が読めなくなっていた）。
    // 見る側の返信バー（z-30）よりは下——あちらは押せるものなので前に出す。
    // 文字は `pointer-events-none` なので、上に乗っても操作を塞がない
    const Z = 25;
    const area: React.CSSProperties = box
        ? { left: box.left, top: box.top, width: box.width, height: box.height, zIndex: Z }
        : { inset: 0, zIndex: Z };
    const fontSize = box
        ? `${Math.round(box.width * STORY_SIZES[style.size])}px`
        : `${(STORY_SIZES[style.size] * 100).toFixed(1)}vw`;

    const filled = style.bg === "solid";
    return (
        <div className="absolute pointer-events-none" style={area} aria-hidden={false}>
            <p
                className="absolute whitespace-pre-wrap break-words text-center"
                style={{
                    left: `${style.x * 100}%`,
                    top: `${style.y * 100}%`,
                    // **端では中央合わせをやめて、縁に寄せる。**
                    //
                    // いつも `translate(-50%, -50%)` だと、箱が広いときに
                    // 端へ置いた文字が**画面の外へ切れる**（実測: 左が 5px 欠けた）。
                    // ずらす量を割合そのものにすると、x=0 で左揃え・x=1 で右揃え・
                    // x=0.5 で中央になり、箱は必ず絵の中に収まる
                    // （箱の左端 = x × (絵の幅 − 箱の幅) なので 0 以上・はみ出さない）。
                    // 指の下から少しずれるが、それは「端に寄せた」という意図どおり
                    transform: `translate(${-style.x * 100}%, ${-style.y * 100}%)`,
                    // 端に置いても読める幅を残す（はみ出す前に折り返す）
                    maxWidth: "86%",
                    fontFamily: font.css,
                    fontWeight: font.weight,
                    fontSize,
                    lineHeight: 1.25,
                    // 下地が「塗り」のときは、選んだ色が下地になり文字が反転する
                    color: filled ? color.on : color.hex,
                    background: filled ? color.hex : style.bg === "soft" ? "rgba(0,0,0,0.45)" : "transparent",
                    padding: style.bg === "none" ? 0 : "0.18em 0.5em",
                    borderRadius: style.bg === "none" ? 0 : "0.35em",
                    // **下地が無いときは影で浮かせる。** 白い空や雪の上に
                    // 白い文字を置くと、影が無いと消える
                    textShadow: style.bg === "none" ? "0 2px 8px rgba(0,0,0,0.65), 0 0 2px rgba(0,0,0,0.5)" : "none",
                    opacity: dimmed ? 0.75 : 1,
                }}
            >
                {text}
            </p>
        </div>
    );
}
