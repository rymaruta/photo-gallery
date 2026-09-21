"use client";

import React from "react";
import { STORY_FONTS, STORY_COLORS, clampStoryTextRotate, type StoryText } from "@/lib/utils/storyText";
import type { MediaBox } from "@/lib/hooks/useMediaBox";
import { ROTATE_STEP_DEG, ROTATE_STEP_DEG_COARSE, stepSize } from "@/lib/utils/storyTransform";

/**
 * ストーリーに載せた文字を描く。
 *
 * **見る側と、置いている最中の下書きが同じものを使う。** 別々に書くと
 * 「置いた場所と出る場所が違う」になり、置き直しても直らない
 * （このリポジトリが何度も踏んでいる「規則を2か所に書く」型）。
 *
 * 大きさは**絵の幅に対する割合**。px で持つと、撮った端末と見る端末で
 * 別の大きさになる。
 *
 * **並びが重なり順**——後ろの要素ほど手前に出る（DOM の順のまま）。
 */
export default function StoryTextOverlay({
    texts, box, selectedIndex, onPickIndex, onNudge, onTransform, onGrabHandle, locale, dimmed,
}: {
    texts: readonly StoryText[];
    /** 絵が実際に描かれている矩形。測れていなければ囲み全体に載せる */
    box: MediaBox | null;
    /** 下書きで選んでいる文字（見る側では渡さない） */
    selectedIndex?: number | null;
    /** 掴んだ文字を選ぶ（渡すと掴めるようになる＝下書きの画面） */
    onPickIndex?: (index: number, e: React.PointerEvent<HTMLElement>) => void;
    /**
     * 矢印キーで少し動かす。**指でなぞれない人の唯一の動かし方**
     * ——渡さないとキーボードでは置き場所を決められない。
     */
    onNudge?: (index: number, dx: number, dy: number) => void;
    /**
     * キーボードで回す・大きさを変える。**矢印キーは「動かす」に
     * 割り当て済み**なので、回すのは別のキー（`[` `]` と `-` `+`）。
     * 渡さないとキーボードでは傾けられない——ハンドルは指だけの道具になる。
     */
    onTransform?: (index: number, patch: { rotate?: number; size?: number }) => void;
    /**
     * 角のハンドルを掴んだ（拡大縮小・回転の始まり）。
     * 渡したときだけハンドルを描く。
     */
    onGrabHandle?: (index: number, e: React.PointerEvent<HTMLElement>) => void;
    locale?: "ja" | "en";
    /** 掴んでいる間などに少し透かす（下の写真を確かめられるように） */
    dimmed?: boolean;
}) {
    // **スクリム（上下の黒いグラデーション）より上に出す。** 下に置くと
    // 白い文字が灰色に沈む（実測: 下書きの画面で文字が読めなくなっていた）。
    // 見る側の返信バー（z-30）よりは下——あちらは押せるものなので前に出す。
    const Z = 25;
    // 測れていないときは囲み全体（文字を消さない）。**幅が取れないと
    // 文字の大きさも決められない**ので、そのときだけ vw で置く
    const area: React.CSSProperties = box
        ? { left: box.left, top: box.top, width: box.width, height: box.height, zIndex: Z }
        : { inset: 0, zIndex: Z };
    const editable = !!onPickIndex;

    return (
        <div className="absolute pointer-events-none" style={area}>
            {texts.map((t, i) => {
                const font = STORY_FONTS[t.font];
                const color = STORY_COLORS[t.color];
                const filled = t.bg === "solid";
                const selected = editable && selectedIndex === i;
                // **「無い＝0度」はここ1か所で決める**（`clampStoryTextRotate` が
                // `undefined` を 0 に落とす）。保存済みのストーリーは
                // `rotate` を実際に持たない
                const rotate = clampStoryTextRotate(t.rotate);
                return (
                    <p
                        key={i}
                        data-story-text-index={i}
                        onPointerDown={onPickIndex ? (e) => onPickIndex(i, e) : undefined}
                        // **キーボードでも選べて、動かせる。** 指でなぞる以外の
                        // 手が無いと、置き場所を決められない人がいる
                        // （このリポジトリは同じ形を何度も直している）
                        {...(editable ? {
                            role: "button",
                            tabIndex: 0,
                            "aria-pressed": selected,
                            // **できる操作を全部名乗る。** 回転を足したのに
                            // 読み上げが「矢印キーで動かせます」のままだと、
                            // 指でなぞれない人には**傾けられること自体が伝わらない**
                            "aria-label": locale === "en"
                                ? `Text "${t.text}" — arrow keys to move, [ and ] to rotate, + and - to resize`
                                : `文字「${t.text}」 — 矢印キーで移動、[ と ] で回転、+ と - で大きさ`,
                            onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
                                // 1回で 2%。Shift で 10%（端まで何度も押さずに済む）
                                const step = e.shiftKey ? 0.1 : 0.02;
                                const d: Record<string, [number, number]> = {
                                    ArrowLeft: [-step, 0], ArrowRight: [step, 0],
                                    ArrowUp: [0, -step], ArrowDown: [0, step],
                                };
                                const move = d[e.key];
                                if (move && onNudge) {
                                    e.preventDefault();
                                    onNudge(i, move[0], move[1]);
                                    return;
                                }
                                // **回す・大きさを変えるのは矢印以外のキー。**
                                // 矢印は「動かす」に割り当て済みなので奪わない。
                                // 角のハンドルは指の道具——これが無いと、
                                // なぞれない人は傾けられない
                                if (!onTransform) return;
                                const turn = e.shiftKey ? ROTATE_STEP_DEG_COARSE : ROTATE_STEP_DEG;
                                if (e.key === "[") {
                                    e.preventDefault();
                                    onTransform(i, { rotate: rotate - turn });
                                } else if (e.key === "]") {
                                    e.preventDefault();
                                    onTransform(i, { rotate: rotate + turn });
                                } else if (e.key === "+" || e.key === "=") {
                                    e.preventDefault();
                                    onTransform(i, { size: stepSize(t.size, 1) });
                                } else if (e.key === "-") {
                                    e.preventDefault();
                                    onTransform(i, { size: stepSize(t.size, -1) });
                                }
                            },
                        } : {})}
                        className={`absolute whitespace-pre-wrap break-words text-center ${editable ? "pointer-events-auto cursor-move focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" : ""}`}
                        style={{
                            left: `${t.x * 100}%`,
                            top: `${t.y * 100}%`,
                            // **端では中央合わせをやめて、縁に寄せる。**
                            //
                            // いつも `translate(-50%, -50%)` だと、箱が広いときに
                            // 端へ置いた文字が**画面の外へ切れる**（実測: 左が 5px 欠けた）。
                            // ずらす量を割合そのものにすると、x=0 で左揃え・x=1 で右揃え・
                            // x=0.5 で中央になり、箱は必ず絵の中に収まる
                            // （箱の左端 = x × (絵の幅 − 箱の幅) なので 0 以上・はみ出さない）。
                            // **回すのは最後（＝いちばん右に書く）。**
                            // CSS の transform は右から当たるので、
                            // `translate(...) rotate(...)` は「回してから運ぶ」。
                            // 逆に書くと、運ぶ量そのものが回ってしまい、
                            // **傾けた瞬間に文字が別の場所へ飛ぶ**。
                            //
                            // 回す中心は箱の真ん中（`transform-origin` の既定）。
                            // 端に置いた文字は、回すと角が絵からはみ出しうるが、
                            // **それは傾けた人が見て決めたこと**なので直さない
                            // （挟み込むと、指で回しても途中で止まって理由が分からない）。
                            //
                            // **傾き 0 なら `rotate()` を書かない。** 保存側で
                            // 「0 は書かない」と決めたのと同じ理由——傾けていない
                            // 文字は、データも DOM も**この変更の前と同じ**になる。
                            transform: `translate(${-t.x * 100}%, ${-t.y * 100}%)`
                                + (rotate === 0 ? "" : ` rotate(${rotate}deg)`),
                            // 端に置いても読める幅を残す（はみ出す前に折り返す）
                            maxWidth: "86%",
                            fontFamily: font.css,
                            fontWeight: font.weight,
                            fontSize: box
                                ? `${Math.round(box.width * t.size)}px`
                                : `${(t.size * 100).toFixed(1)}vw`,
                            lineHeight: 1.25,
                            // 下地が「塗り」のときは、選んだ色が下地になり文字が反転する
                            color: filled ? color.on : color.hex,
                            background: filled ? color.hex : t.bg === "soft" ? "rgba(0,0,0,0.45)" : "transparent",
                            padding: t.bg === "none" ? 0 : "0.18em 0.5em",
                            borderRadius: t.bg === "none" ? 0 : "0.35em",
                            // **下地が無いときは影で浮かせる。** 白い空や雪の上に
                            // 白い文字を置くと、影が無いと消える
                            textShadow: t.bg === "none" ? "0 2px 8px rgba(0,0,0,0.65), 0 0 2px rgba(0,0,0,0.5)" : "none",
                            opacity: dimmed ? 0.75 : 1,
                            // **選んでいるものが分かるようにする。** 複数置けるので、
                            // どれを直しているのかが見えないと操作の欄が誰に効くか分からない
                            outline: selected ? "2px dashed rgba(255,255,255,0.9)" : undefined,
                            outlineOffset: selected ? "4px" : undefined,
                            // 掴む的を広げる（指の太さ。下地なしの細い文字でも掴める）
                            touchAction: editable ? "none" : undefined,
                        }}
                    >
                        {t.text}
                        {/* **角のハンドル。** 掴んで回すと傾き、離すと大きさが決まる。
                            選んでいる1つにだけ出す（全部に出すと写真が的だらけになる）。

                            **回した箱の子に置く。** そうすれば CSS が一緒に回すので、
                            傾けた角の位置を自分で計算しなくてよい（計算して外に置くと、
                            角度の式を2か所——描く側と当たり判定——に持つことになる）。

                            **Tab では止まらない**（`tabIndex={-1}`）。同じことは
                            親の `[` `]` `+` `-` でできて、そちらは読み上げが
                            名乗っている。止めると「同じ操作に2つの止まり場」ができる */}
                        {selected && onGrabHandle && (
                            <button
                                type="button"
                                tabIndex={-1}
                                data-story-text-handle={i}
                                onPointerDown={(e) => {
                                    // **親へ伝えない。** 親の pointerdown は
                                    // 「掴んで動かす」を始めるので、伝えると
                                    // 回そうとした指で文字が運ばれる
                                    e.stopPropagation();
                                    onGrabHandle(i, e);
                                }}
                                aria-label={locale === "en"
                                    ? "Drag to resize and rotate"
                                    : "なぞって大きさと傾きを変える"}
                                className="absolute pointer-events-auto flex items-center justify-center"
                                style={{
                                    // 箱の右下の角。的は指の太さ（44px）、見えるのは 18px
                                    right: 0,
                                    bottom: 0,
                                    width: "44px",
                                    height: "44px",
                                    transform: "translate(50%, 50%)",
                                    touchAction: "none",
                                    // 文字の大きさに引きずられない（`em` は親の字の大きさ）
                                    fontSize: "16px",
                                }}
                            >
                                <span
                                    aria-hidden
                                    style={{
                                        width: "18px",
                                        height: "18px",
                                        borderRadius: "9999px",
                                        background: "rgba(255,255,255,0.95)",
                                        // 白い写真の上でも見えるように縁を付ける
                                        boxShadow: "0 0 0 2px rgba(0,0,0,0.45)",
                                        display: "block",
                                    }}
                                />
                            </button>
                        )}
                    </p>
                );
            })}
        </div>
    );
}
