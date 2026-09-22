"use client";

import React from "react";
import {
    STORY_FONTS, STORY_COLORS, STORY_STAMPS, clampStoryTextRotate,
    isStoryStamp, isStoryVote, isStoryTextItem,
    type StoryText, type StoryVoteChoice, type StoryVoteState,
} from "@/lib/utils/storyText";
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
    onVote, voteState, voting,
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
    /**
     * 投票スタンプの2択に票を入れる（見る側）。**渡したときだけ `<button>` に
     * する**——下書きや未ログインでは押しても効かない的を置かない。
     * 既に入れてある（`voteState.myVote`）ときも押せない（1人1票・変えられない）
     */
    onVote?: (index: number, choice: StoryVoteChoice) => void;
    /** 票の状態。`counts` が在るときだけ数を出す（投稿者と入れた人だけに届く） */
    voteState?: StoryVoteState;
    /** 送っている間（二度押しを止める） */
    voting?: boolean;
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
                // **スタンプと文字は同じ仕組みに乗る**（置く・動かす・回す・
                // 重ねる・消す）。違うのは**中身と、字体まわりを持つかどうか**
                // だけなので、分岐はここに閉じる。
                //
                // **知らない絵柄は、文字として描かない。** 引き当てた結果で
                // 分岐すると、一覧に無い鍵が**文字の枝へ落ちて**
                // `text` を持たないまま描かれる——中身も読み上げも空の `<p>` が
                // 出て（置いたスタンプが消えた投稿に見える）、下書き側では
                // `name.trim()` が TypeError になる。**その要素だけ描かない**
                // のが正しい（`sanitizeStoryTexts` も同じ値を落としている）。
                if (isStoryStamp(t) && !STORY_STAMPS[t.stamp]) return null;
                const stamp = isStoryStamp(t) ? STORY_STAMPS[t.stamp] : null;
                const vote = isStoryVote(t) ? t : null;
                // **`as` で握らない。** 種類で絞る——握っていた頃は、投票が
                // 文字の枝へ落ちて `font` が `undefined` になり、下で
                // `name.trim()` が落ちた（知らない絵柄と同じ穴）
                // 型の述語で絞る（`stamp || vote ? null : t` では `t` が絞られない）
                const text = isStoryTextItem(t) ? t : null;
                // どれでもない（将来の種類）は描かない——`!` で握ると
                // `name.trim()` が TypeError になる
                if (!stamp && !vote && !text) return null;
                const font = text ? STORY_FONTS[text.font] : null;
                // **投票は「白い塗りの下地」を借りる。** `filled` の経路が
                // そのまま白いカード（白地・黒字・角丸・影なし）になるので、
                // カードの見た目を別に書かない
                const color = text ? STORY_COLORS[text.color] : vote ? STORY_COLORS.white : null;
                const bg = text ? text.bg : vote ? "solid" : "none";
                const filled = bg === "solid";
                const selected = editable && selectedIndex === i;
                /** この投票に、いま票を入れられるか（口があり・まだ入れていない） */
                const canVote = !!vote && !!onVote && !voteState?.myVote;
                /** 読み上げ・掴む的の名前。スタンプは絵柄の名前、投票は問い */
                const name = stamp ? stamp.label : vote ? vote.question : text ? text.text : "";
                const kindLabel = stamp
                    ? (locale === "en" ? "Sticker" : "スタンプ")
                    : vote ? (locale === "en" ? "Poll" : "投票") : (locale === "en" ? "Text" : "文字");
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
                                ? `${kindLabel} "${name}" — arrow keys to move, [ and ] to rotate, + and - to resize`
                                : `${kindLabel}「${name}」 — 矢印キーで移動、[ と ] で回転、+ と - で大きさ`,
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
                                // **`{` `}` も受ける。** `Shift` を押しながらの
                                // `[` `]` は、ブラウザが `e.key` に `{` `}` を
                                // 入れる——`[` `]` だけを見ていたので
                                // **`Shift` の刻み（15度）にはどうやっても
                                // 届かなかった**（対テストが `{ key: "]",
                                // shiftKey: true }` という実ブラウザでは起きない
                                // 組み合わせを投げていて、それで緑になっていた）
                                if (e.key === "[" || e.key === "{") {
                                    e.preventDefault();
                                    onTransform(i, { rotate: rotate - turn });
                                } else if (e.key === "]" || e.key === "}") {
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
                        // 見る側は触れない（`pointer-events-none` の親のまま）。
                        // 票を入れる `<button>` だけが受ける（下で `pointer-events-auto`）
                        // ——箱ごと受けると、問いの部分が右上の閉じるボタンなどを
                        // 覆ったときにそちらが押せなくなる
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
                            // スタンプは絵文字なので字体を当てない（端末の絵文字が出る）
                            ...(font ? { fontFamily: font.css, fontWeight: font.weight } : {}),
                            fontSize: box
                                ? `${Math.round(box.width * t.size)}px`
                                : `${(t.size * 100).toFixed(1)}vw`,
                            lineHeight: 1.25,
                            // 下地が「塗り」のときは、選んだ色が下地になり文字が反転する
                            ...(color ? { color: filled ? color.on : color.hex } : {}),
                            background: filled && color ? color.hex : bg === "soft" ? "rgba(0,0,0,0.45)" : "transparent",
                            padding: bg === "none" ? 0 : "0.18em 0.5em",
                            borderRadius: bg === "none" ? 0 : "0.35em",
                            // **下地が無いときは影で浮かせる。** 白い空や雪の上に
                            // 白い文字を置くと、影が無いと消える
                            textShadow: bg === "none" ? "0 2px 8px rgba(0,0,0,0.65), 0 0 2px rgba(0,0,0,0.5)" : "none",
                            opacity: dimmed ? 0.75 : 1,
                            // **選んでいるものが分かるようにする。** 複数置けるので、
                            // どれを直しているのかが見えないと操作の欄が誰に効くか分からない
                            outline: selected ? "2px dashed rgba(255,255,255,0.9)" : undefined,
                            outlineOffset: selected ? "4px" : undefined,
                            // 掴む的を広げる（指の太さ。下地なしの細い文字でも掴める）
                            touchAction: editable ? "none" : undefined,
                        }}
                    >
                        {stamp
                            ? <span role="img" aria-label={stamp.label}>{stamp.glyph}</span>
                            : vote
                                ? (
                                    <span className="block" data-story-vote>
                                        <span className="block font-bold" style={{ marginBottom: "0.4em" }}>{vote.question}</span>
                                        <span className="flex gap-2" style={{ fontSize: "0.9em" }}>
                                            {vote.options.map((opt, k) => {
                                                const choice: StoryVoteChoice = k === 0 ? "a" : "b";
                                                const counts = voteState?.counts;
                                                const total = counts ? counts.a + counts.b : 0;
                                                const n = counts ? counts[choice] : 0;
                                                // 数が見えて、票が1つでもあるときだけ割合。
                                                // **b は 100 − a**（両方を丸めると 13%＋88% のように
                                                // 和が 101 になる組がある）。0票は割合を出さない
                                                // （0%/0% は引き分けに読める。下に「まだ票はありません」）
                                                const pctA = total > 0 && counts ? Math.round((counts.a / total) * 100) : null;
                                                const pct = pctA === null ? null : choice === "a" ? pctA : 100 - pctA;
                                                const mine = voteState?.myVote === choice;
                                                const pill: React.CSSProperties = {
                                                    padding: "0.35em 0.6em",
                                                    // 数が見えるときは、割合ぶんを薄く塗る（棒グラフの代わり）
                                                    background: pct === null
                                                        ? "rgba(0,0,0,0.08)"
                                                        : `linear-gradient(90deg, rgba(0,0,0,0.18) ${pct}%, rgba(0,0,0,0.06) ${pct}%)`,
                                                    fontWeight: mine ? 700 : undefined,
                                                };
                                                const label = pct === null ? opt : `${opt} ${pct}%`;
                                                // **押せるのは、口があって・まだ入れていないときだけ。**
                                                // それ以外は `<button>` にしない（押しても効かない的）
                                                return canVote ? (
                                                    <button
                                                        key={k}
                                                        type="button"
                                                        disabled={voting}
                                                        onClick={() => onVote!(i, choice)}
                                                        aria-label={locale === "en" ? `Vote "${opt}"` : `「${opt}」に投票`}
                                                        // 親（この段全体）は `pointer-events-none`。**ボタンだけ**受ける
                                                        // ——左右のタップ領域（z-10）より上（Z=25）なので押しても進まない
                                                        className="pointer-events-auto flex-1 rounded-full text-center disabled:opacity-60"
                                                        style={{ ...pill, font: "inherit", color: "inherit", cursor: "pointer" }}
                                                    >
                                                        {opt}
                                                    </button>
                                                ) : (
                                                    <span
                                                        key={k}
                                                        className="flex-1 rounded-full text-center"
                                                        style={pill}
                                                        {...(mine ? { "aria-current": "true" as const } : {})}
                                                    >
                                                        {mine ? "✓ " : ""}{label}
                                                        {/* 読み上げには票の数も（画面は割合だけ）。
                                                            role の無い span の aria-label は読まれないので、隠し文字で */}
                                                        {pct !== null && (
                                                            <span className="sr-only">{locale === "en" ? ` (${n} votes)` : `（${n}票）`}</span>
                                                        )}
                                                    </span>
                                                );
                                            })}
                                        </span>
                                        {/* 数が見えるのに 0 票——0%/0% は引き分けに読めるので言葉で */}
                                        {voteState?.counts && voteState.counts.a + voteState.counts.b === 0 && (
                                            <span className="block" style={{ fontSize: "0.8em", marginTop: "0.4em", opacity: 0.7 }}>
                                                {locale === "en" ? "No votes yet" : "まだ票はありません"}
                                            </span>
                                        )}
                                    </span>
                                )
                                : name}
                        {/* **角のハンドル。** 掴んで回すと傾き、離すと大きさが決まる。
                            選んでいる1つにだけ出す（全部に出すと写真が的だらけになる）。

                            **回した箱の子に置く。** そうすれば CSS が一緒に回すので、
                            傾けた角の位置を自分で計算しなくてよい（計算して外に置くと、
                            角度の式を2か所——描く側と当たり判定——に持つことになる）。

                            **Tab では止まらない**（`tabIndex={-1}`）。同じことは
                            親の `[` `]` `+` `-` でできて、そちらは読み上げが
                            名乗っている。止めると「同じ操作に2つの止まり場」ができる

                            **文言が空のうちは出さない。** 「＋」で足した直後の
                            文字は `text: ""` で箱が 0×0——そこにハンドルを出すと、
                            中心からの距離がほぼ 0 の点を掴むことになり、
                            **少し動かしただけで大きさが上限に張り付き、
                            傾きも雑音から決まる**。打つものが無い文字に
                            大きさも傾きも無い */}
                        {selected && onGrabHandle && name.trim() !== "" && (
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
