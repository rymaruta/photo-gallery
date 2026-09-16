import { describe, it, expect } from "vitest";
import { collectOwnValues, appendTag, toggleTag, hasTag, suggestTags, dropFragment, typingFragment } from "../ownValues";
import type { Photo } from "../../data/photos";

const P = (over: Partial<Photo>) => ({ id: "x", src: "s", ...over }) as Photo;

// 入力の助けが無いせいで、同じ場所が別々の名前に散っていた。
// 「前に何と書いたか」を思い出せるようにするための候補集め。
describe("collectOwnValues", () => {
    it("よく使う順に並べる（同数なら文字順で毎回同じ並び）", () => {
        const photos = [
            P({ location: "パリ" }), P({ location: "パリ" }), P({ location: "東京" }),
            P({ category: "風景" }), P({ category: "街" }),
        ];
        const v = collectOwnValues(photos);
        expect(v.locations).toEqual(["パリ", "東京"]);
        expect(v.categories).toEqual(["街", "風景"]);   // 同数 → 文字順
    });

    it("空白だけ・空文字・非文字列は候補にしない", () => {
        const photos = [
            P({ location: "   " }), P({ location: "" }),
            P({ category: undefined }),
        ];
        const v = collectOwnValues(photos);
        expect(v.locations).toEqual([]);
        expect(v.categories).toEqual([]);
    });

    it("前後の空白は落として同じ値にまとめる", () => {
        const v = collectOwnValues([P({ location: " 京都 " }), P({ location: "京都" })]);
        expect(v.locations).toEqual(["京都"]);
    });

    // 下書きも数える。公開状態は「前に何と書いたか」と関係ない
    it("下書きの値も候補に入れる", () => {
        const v = collectOwnValues([P({ location: "下書きの場所", published: false })]);
        expect(v.locations).toEqual(["下書きの場所"]);
    });

    it("件数を絞れる（候補が多すぎると選べない）", () => {
        const photos = Array.from({ length: 50 }, (_, i) => P({ location: `場所${i}` }));
        expect(collectOwnValues(photos, 5).locations).toHaveLength(5);
    });

    it("写真が無い・null でも落ちない", () => {
        expect(collectOwnValues(null)).toEqual({ locations: [], categories: [] });
        expect(collectOwnValues([])).toEqual({ locations: [], categories: [] });
    });
});

// タグ欄は datalist が使えない。datalist は**欄全体**を選んだ値で置き換える
// ので、「自然, 山」と書いている途中に候補を選ぶと既に入れた分が消える。
describe("appendTag（カンマ区切りに1つ足す）", () => {
    it("末尾に足す", () => {
        expect(appendTag("自然, 山", "夜景")).toBe("自然, 山, 夜景, ");
    });

    it("空の欄にも足せる", () => {
        expect(appendTag("", "夜景")).toBe("夜景, ");
        expect(appendTag("   ", "夜景")).toBe("夜景, ");
    });

    it("既にあるタグは足さない（重複させない）", () => {
        expect(appendTag("自然, 山", "山")).toBe("自然, 山");
    });

    // 何も足さない回に入力を書き換えると、押しただけで自分の書いた空白が
    // 変わって驚く。**足すときだけ整える**。
    it("足さない回は入力をそのまま返す（勝手に整形しない）", () => {
        expect(appendTag("自然,  山 ", "山")).toBe("自然,  山 ");
    });

    it("区切りの空白を揃える（サーバーの trim と同じ形にする）", () => {
        expect(appendTag("自然,山", "海")).toBe("自然, 山, 海, ");
    });

    it("空のタグは無視する", () => {
        expect(appendTag("自然", "  ")).toBe("自然");
    });
});

// **同じタグのチップが2つ並んでいた。** 実測（修正前）:
//   collectOwnValues([{tags:["Fuji"]},{tags:["fuji"]},{tags:["fuji"]},
//                     {tags:["#旅"]},{tags:["旅"]}]).tags
//     → ["fuji", "#旅", "Fuji", "旅"]
//   appendTag("fuji", "Fuji") → "fuji, Fuji"
// 絞り込み側は `dca777a` / `e731478` で `tagKey` に畳んだので、
// 入力の助け（候補チップと押して足すチップ）だけが完全一致のまま残っていた。

describe("appendTag は同じタグを二重に足さない", () => {
    it("大小違いの候補を押しても増えない", () => {
        expect(appendTag("fuji", "Fuji")).toBe("fuji");
    });

    it("# の有無だけの違いも同じタグ扱い", () => {
        expect(appendTag("旅", "#旅")).toBe("旅");
    });

    it("複数入っている欄でも、既にある方を見る", () => {
        expect(appendTag("夜景, Fuji", "fuji")).toBe("夜景, Fuji");
    });

    // 正常系: 別のタグは足す（畳みすぎて足せなくならないこと）
    it("別のタグは足す", () => {
        expect(appendTag("夜景", "富士山")).toBe("夜景, 富士山, ");
        expect(appendTag("", "山")).toBe("山, ");
    });
});

/**
 * **同数のときの決着を「最後に使った順」にした。**
 *
 * 実データで数えたら 59種のうち **44種が1枚にしか付いていない**ので、
 * ほとんどが `total === 1` で並び、決着は文字順だけだった。
 * `localeCompare` は**日本語をラテン文字の後ろに置く**（実測
 * `apple < zebra < 白鳥 < 苔`）ので、上限30で切ると**日本語から落ちる**。
 * 実測: 隠れた29種のうち10種が日本語／チップに出ていた日本語は2種。
 * 直したあと **8種**が出るようになった（隠れた日本語は4種）。
 */

// 変異で見つかった穴2つ（どちらも等価ではなく、見ていなかっただけ）

/**
 * **候補チップは「選ぶ」もの。押し直したら外れる。**
 *
 * もとは足すだけだったので、**既に付いているタグのチップを押しても
 * 何も起きなかった**（見た目も変わらないので、押せていないのか効かないのかも
 * 分からない）。同じ場面を一覧の絞り込み（`FilterBar` のタグチップ）は
 * **押し直して外す**形にしてあり、投稿・編集の候補チップだけ古いままだった。
 */
describe("hasTag（いま欄に入っているか）", () => {
    it("大小・`#`・日英の別名を畳んで見る", () => {
        expect(hasTag("fuji, 夜景", "Fuji")).toBe(true);
        expect(hasTag("旅", "#旅")).toBe(true);
        expect(hasTag("風景", "landscape"), "別名表が効いていない").toBe(true);
        expect(hasTag("夜景", "富士山")).toBe(false);
    });

    it("空の欄・空のタグで誤判定しない", () => {
        expect(hasTag("", "山")).toBe(false);
        expect(hasTag("山", "   "), "空のタグが当たっている").toBe(false);
        // **欄の末尾のカンマと、空のタグが噛み合う形。** 空の判定を外すと
        // `tagKey("")` どうしが一致して「入っている」になる（欄が
        // `"山, "` のときに空のタグが当たる）
        expect(hasTag("山, ", "  "), "空のタグが空の欄に当たっている").toBe(false);
        expect(hasTag(" , ,山", "山")).toBe(true);
    });
});

describe("toggleTag（押し直したら外れる）", () => {
    it("入っていなければ足す", () => {
        expect(toggleTag("自然, 山", "夜景")).toBe("自然, 山, 夜景, ");
        expect(toggleTag("", "山")).toBe("山, ");
    });

    it("入っていれば外す", () => {
        expect(toggleTag("自然, 山", "山"), "押しても何も起きない").toBe("自然, ");
        expect(toggleTag("山", "山")).toBe("");
    });

    // 外すときも畳んで見る（`fuji` の欄で候補の `Fuji` を押したら外れる）
    it("書き方が違っても、同じタグなら外れる", () => {
        expect(toggleTag("夜景, Fuji", "fuji")).toBe("夜景, ");
        expect(toggleTag("旅", "#旅")).toBe("");
        expect(toggleTag("風景, 山", "landscape")).toBe("山, ");
    });

    // 空のタグのガードは `appendTag` 側に1つだけ置く（二重にすると
    // 片方を壊しても気づけない）。ここはその委譲が効いていることを見る
    it("空のタグでは何もしない", () => {
        expect(toggleTag("自然", "  ")).toBe("自然");
        expect(toggleTag("", "  ")).toBe("");
    });

    // 欄に空の要素が混じっていても、外した結果にゴミを残さない
    it("空の要素を挟んだ欄でも、外した結果が汚れない", () => {
        expect(toggleTag("自然, , 山", "山"), "空の要素が残っている").toBe("自然, ");
        expect(toggleTag(" , ,山", "山")).toBe("");
    });

    // **足す側は `appendTag` に任せる**——何も変わらない回に元の文字列を
    // そのまま返す性質（空白の入れ方を勝手に直さない）を壊さない
    it("足す側の空白の扱いは変えない", () => {
        expect(toggleTag("自然,山", "海")).toBe("自然, 山, 海, ");
    });
});

/**
 * **打ちかけの文字で候補を絞る。**
 *
 * チップの枠は12個だが、owner のタグは実データで59種——何も打たないと
 * 上位12種しか選べず、**残り47種（80%）は打つしかない**。打つから表記が
 * 割れる。絞れば実データで **打ち切る手前で58/59が12枠に入る**。
 */
describe("suggestTags（打ちかけの文字で絞る）", () => {
    const all = ["finland", "winter", "helsinki", "風景", "夜景", "山中湖", "sauna"];

    it("何も打っていなければ、よく使う順のまま上から出す", () => {
        expect(suggestTags(all, "", 3)).toEqual(["finland", "winter", "helsinki"]);
        // 欄に入っているタグ（夜景）は先頭へ。押し直して外せるようにするため
        expect(suggestTags(all, "夜景, ", 3), "カンマの後ろは空として扱う").toEqual(["夜景", "finland", "winter"]);
    });

    // **打ち終わったら絞りを解く。** チップを1つ押すと欄は `夜景` になる
    // ——そこで絞ったままだと**他の候補が全部消えて**、2つ目をカンマから
    // 打ち直すことになる（続けて選べない）
    it("最後の欠片が候補と丸ごと同じなら、絞らない", () => {
        // 選んだものが先頭に来たうえで、**他の候補も出る**（続けて選べる）
        expect(suggestTags(all, "夜景", 3), "1つ選んだら他が選べない").toEqual(["夜景", "finland", "winter"]);
        expect(suggestTags(all, "夜景, 山中湖", 3)).toEqual(["夜景", "山中湖", "finland"]);
        // 別名で書いても「選び終えた1つ」と見る
        expect(suggestTags(["landscape", "夜景"], "風景", 3)).toEqual(["landscape", "夜景"]);
    });

    it("**最後のカンマから後ろ**で絞る（前に入れたタグに引きずられない）", () => {
        expect(suggestTags(all, "fin")).toEqual(["finland"]);
        expect(suggestTags(all, "夜景, hel"), "前のタグで絞っている").toEqual(["helsinki"]);
    });

    it("途中の文字でも当たる（前方一致に限らない）", () => {
        expect(suggestTags(all, "inla"), "前方一致しか見ていない").toEqual(["finland"]);
        expect(suggestTags(all, "中湖")).toEqual(["山中湖"]);
    });

    // **別名表を通した一致は、意図どおり**。`land` と打つと `finland` の
    // ほかに `風景` も出る——このサイトは `風景` と `landscape` を同じタグと
    // して畳むので（`tagKey`）、`land` は `landscape` の一部として当たる。
    // 打った人が探しているのは「landscape のこと」で、既に使っている綴りが
    // `風景` なら**それを出すのが正しい**（新しい綴りを増やさない）
    it("別名表を通して、既に使っている綴りの方を出す", () => {
        expect(suggestTags(all, "land")).toEqual(["finland", "風景"]);
    });

    it("大小と `#` は無視する", () => {
        expect(suggestTags(all, "FIN")).toEqual(["finland"]);
        expect(suggestTags(all, "#風")).toEqual(["風景"]);
    });

    it("一致が無ければ空（関係ない候補を並べない）", () => {
        expect(suggestTags(all, "zzz")).toEqual([]);
    });

    it("絞ったあとも枠で切る", () => {
        const many = Array.from({ length: 20 }, (_, i) => `tag${i}`);
        expect(suggestTags(many, "tag", 12)).toHaveLength(12);
    });

    // **枠の既定値も縛る。** 画面は枠を渡さないので、既定を広げると
    // チップが何十個も並ぶ（実データなら最大59個）
    it("枠を渡さなければ12個まで", () => {
        const many = Array.from({ length: 30 }, (_, i) => `tag${i}`);
        expect(suggestTags(many, ""), "既定の枠が広がっている").toHaveLength(12);
        expect(suggestTags(many, "tag")).toHaveLength(12);
    });
});

/**
 * **打って絞って押したら、打ちかけの文字が残ってはいけない。**
 *
 * 絞りを入れた最初の版は、`sau` と打って `sauna` のチップを押すと
 * 欄が `"sau, sauna"` になった——`sau` がそのまま**写真のタグとして保存される**。
 * 絞りの目的は「打つから表記が割れる」を減らすことなのに、
 * **新しい綴りを増やしていた**（実データ59種の全接頭辞で必ず起きた）。
 */
describe("打ちかけの欠片の扱い", () => {
    const all = ["sauna", "helsinki", "夜景", "白鳥"];

    it("打ちかけかどうかを、1つの判定で決める", () => {
        expect(typingFragment(all, "sau"), "打ちかけを見落としている").toBe("sau");
        expect(typingFragment(all, "夜景, hel")).toBe("hel");
        // 候補と丸ごと同じなら「選び終えた1つ」
        expect(typingFragment(all, "sauna")).toBe("");
        expect(typingFragment(all, "夜景, ")).toBe("");
        expect(typingFragment(all, "")).toBe("");
    });

    it("チップを押すときは、打ちかけの欠片を落とす", () => {
        expect(dropFragment(all, "sau"), "欠片が残る").toBe("");
        expect(dropFragment(all, "夜景, hel")).toBe("夜景");
        // 打ちかけでなければ触らない
        expect(dropFragment(all, "夜景")).toBe("夜景");
        expect(dropFragment(all, "夜景, ")).toBe("夜景, ");
    });

    // 画面と同じ組み合わせ（絞る → 押す）を1本の式で見る
    it("打って絞って押すと、欄には選んだタグだけが入る", () => {
        for (const [typed, expected] of [["sau", ["sauna"]], ["白", ["白鳥"]], ["夜景, hel", ["夜景", "helsinki"]]] as const) {
            const pick = suggestTags(all, typed, 12)[0];
            // **区切りの形ではなく、保存されるタグで見る。** 生の文字列で
            // 比べると、末尾の区切りのような表示上の違いで落ちて、
            // 守りたい性質（欠片がタグとして残らない）が見えなくなる
            const savedTags = toggleTag(dropFragment(all, typed), pick)
                .split(",").map((x) => x.trim()).filter(Boolean);
            expect(savedTags, `「${typed}」で欠片が残った`).toEqual([...expected]);
        }
    });

    // **選んだチップが消えない。** 上位12種の外にあるタグを選ぶと、
    // 絞りが解けた瞬間に視界から消えて押し直して外せなくなっていた
    it("絞っていないときは、欄に入っているタグを先に出す", () => {
        const many = ["a", "b", "c", "d", "zzz"];
        expect(suggestTags(many, "zzz", 3), "選んだタグが候補から消えている").toEqual(["zzz", "a", "b"]);
        expect(suggestTags(many, "", 3)).toEqual(["a", "b", "c"]);
    });
});

/**
 * **チップを押したあと、そのまま打つと新しいタグになる。**
 *
 * 欄はカンマ区切りなのに、押す側が区切りを入れていなかったので
 * `[sauna]` を押して `hokkaido` と打つと `"saunahokkaido"` という
 * **1つの嘘のタグ**が保存されていた。`8774ccd2`（打ちかけの欠片がタグとして
 * 保存される）と同じ型の裏返し——**チップの目的は「打つから表記が割れる」を
 * 減らすこと**なのに、押すたびに新しい綴りを作れる形だった。
 *
 * 実データの owner は1枚に中央値3タグ・最大8タグを日英で付けており、
 * **59種のうち49種はチップに出ない**（上位10種だけ）ので、
 * 押す→打つ→押す、が主動線になる。
 */
describe("押したあとに打つと、新しいタグになる", () => {
    const pool = ["sauna", "winter", "山中湖"];
    /** 画面がやっていること */
    const press = (cur: string, t: string) => toggleTag(dropFragment(pool, cur), t);
    /** 保存されるタグ（サーバーの sanitizeTags と同じ素の分割） */
    const saved = (cur: string) => cur.split(",").map((x) => x.trim()).filter(Boolean);

    it("押してから打つと、前のタグに繋がらない", () => {
        const after = press("", "sauna") + "hokkaido";
        expect(saved(after), "前のタグに繋がっている").toEqual(["sauna", "hokkaido"]);
    });

    it("外してから打つ場合も同じ", () => {
        const after = press(press("", "sauna"), "sauna") + "hokkaido";
        expect(saved(after)).toEqual(["hokkaido"]);
    });

    it("2つ押してから打つ", () => {
        const after = press(press("", "sauna"), "winter") + "北海道";
        expect(saved(after)).toEqual(["sauna", "winter", "北海道"]);
    });

    // **末尾の区切りは保存に響かない**（サーバーは空を落とす）
    it("末尾の区切りが空のタグにならない", () => {
        expect(saved(press("", "sauna"))).toEqual(["sauna"]);
        expect(saved(press(press("", "sauna"), "winter"))).toEqual(["sauna", "winter"]);
    });

    // 空になったら区切りも残さない（`", "` だけの欄を作らない）
    it("全部外したら空文字に戻る", () => {
        expect(press(press("", "sauna"), "sauna")).toBe("");
    });

    // 押した直後は「打ちかけ」が無いので、候補は絞られていない
    it("押した直後の欄は、打ちかけとして扱われない", () => {
        expect(typingFragment(pool, press("", "sauna"))).toBe("");
    });
});
