import { describe, it, expect } from "vitest";
import { collectOwnValues, appendTag, toggleTag, hasTag } from "../ownValues";
import type { Photo } from "../../data/photos";

const P = (over: Partial<Photo>) => ({ id: "x", src: "s", ...over }) as Photo;

// 入力の助けが無いせいで、同じ場所が別々の名前に散っていた。
// 「前に何と書いたか」を思い出せるようにするための候補集め。
describe("collectOwnValues", () => {
    it("よく使う順に並べる（同数なら文字順で毎回同じ並び）", () => {
        const photos = [
            P({ location: "パリ" }), P({ location: "パリ" }), P({ location: "東京" }),
            P({ category: "風景" }), P({ category: "街" }),
            P({ tags: ["夜景", "街"] }), P({ tags: ["夜景"] }),
        ];
        const v = collectOwnValues(photos);
        expect(v.locations).toEqual(["パリ", "東京"]);
        expect(v.categories).toEqual(["街", "風景"]);   // 同数 → 文字順
        expect(v.tags).toEqual(["夜景", "街"]);
    });

    it("空白だけ・空文字・非文字列は候補にしない", () => {
        const photos = [
            P({ location: "   " }), P({ location: "" }),
            P({ tags: ["", "  ", "山"] }),
            P({ category: undefined }),
        ];
        const v = collectOwnValues(photos);
        expect(v.locations).toEqual([]);
        expect(v.categories).toEqual([]);
        expect(v.tags).toEqual(["山"]);
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
        expect(collectOwnValues(null)).toEqual({ locations: [], categories: [], tags: [] });
        expect(collectOwnValues([])).toEqual({ locations: [], categories: [], tags: [] });
    });
});

// タグ欄は datalist が使えない。datalist は**欄全体**を選んだ値で置き換える
// ので、「自然, 山」と書いている途中に候補を選ぶと既に入れた分が消える。
describe("appendTag（カンマ区切りに1つ足す）", () => {
    it("末尾に足す", () => {
        expect(appendTag("自然, 山", "夜景")).toBe("自然, 山, 夜景");
    });

    it("空の欄にも足せる", () => {
        expect(appendTag("", "夜景")).toBe("夜景");
        expect(appendTag("   ", "夜景")).toBe("夜景");
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
        expect(appendTag("自然,山", "海")).toBe("自然, 山, 海");
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
describe("タグは同じもの同士を畳む（比べ方は絞り込みと同じ tagKey）", () => {
    it("大小違い・# つきは1つのチップにまとまる", () => {
        const v = collectOwnValues([
            P({ tags: ["Fuji"] }), P({ tags: ["fuji"] }), P({ tags: ["fuji"] }),
            P({ tags: ["#旅"] }), P({ tags: ["旅"] }),
        ]);
        expect(v.tags, "同じタグのチップが2つ出ている").toHaveLength(2);
    });

    it("代表はいちばん多く使った生表記", () => {
        const v = collectOwnValues([
            P({ tags: ["Fuji"] }), P({ tags: ["Fuji"] }), P({ tags: ["fuji"] }),
        ]);
        expect(v.tags).toEqual(["Fuji"]);
    });

    // **1枚の中で2通り書いた場合の票を落としていた。** 重複除去より
    // 後ろで数えていたので、先に見た方だけが票を持ち、同じ写真集合でも
    // タグ配列の並び順で代表表記が変わっていた（実測で `Fuji` / `fuji`
    // に割れた）。回数の数え方（1枚1回）はそのまま。
    it("1枚が2通りで書いていても、代表は写真集合だけで決まる", () => {
        const a = collectOwnValues([P({ tags: ["Fuji", "fuji"] }), P({ tags: ["Fuji"] })]).tags;
        const b = collectOwnValues([P({ tags: ["fuji", "Fuji"] }), P({ tags: ["Fuji"] })]).tags;
        expect(a, "タグ配列の並び順で代表表記が変わっている").toEqual(b);
        expect(a).toEqual(["Fuji"]);
    });

    it("同数なら文字順で固定（配列の順で入れ替わらない）", () => {
        const a = collectOwnValues([P({ tags: ["Fuji"] }), P({ tags: ["fuji"] })]).tags;
        const b = collectOwnValues([P({ tags: ["fuji"] }), P({ tags: ["Fuji"] })]).tags;
        expect(a).toEqual(b);
    });

    it("1枚が同じタグを2通りで持っていても、2回使ったことにしない", () => {
        const v = collectOwnValues([
            P({ tags: ["旅", "#旅"] }),
            P({ tags: ["山"] }), P({ tags: ["山"] }),
        ]);
        // 「旅」を2回数えると先頭に来てしまう
        expect(v.tags[0]).toBe("山");
    });

    it("別のタグはちゃんと並ぶ（畳みすぎない）", () => {
        const v = collectOwnValues([P({ tags: ["富士山", "夜景"] })]);
        expect(v.tags.sort()).toEqual(["夜景", "富士山"].sort());
    });
});

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
        expect(appendTag("夜景", "富士山")).toBe("夜景, 富士山");
        expect(appendTag("", "山")).toBe("山");
    });
});

/**
 * **同数のときの決着を「最後に使った順」にした。**
 *
 * 実データで数えたら 62種のうち **46種が1枚にしか付いていない**ので、
 * ほとんどが `total === 1` で並び、決着は文字順だけだった。
 * `localeCompare` は**日本語をラテン文字の後ろに置く**（実測
 * `apple < zebra < 白鳥 < 苔`）ので、上限30で切ると**日本語から落ちる**。
 * 実測: 隠れた29種のうち10種が日本語／チップに出ていた日本語は2種。
 * 直したあと **8種**が出るようになった（隠れた日本語は4種）。
 */
describe("タグの候補は、同数なら最後に使った順", () => {
    it("同数なら新しく使った方が先", () => {
        const photos = [
            P({ tags: ["ふるい"], createdAt: "2024-01-01T00:00:00Z" }),
            P({ tags: ["あたらしい"], createdAt: "2026-09-01T00:00:00Z" }),
        ];
        expect(collectOwnValues(photos).tags).toEqual(["あたらしい", "ふるい"]);
    });

    // **回数が先なのは変えない。** よく使うタグが上に来る性質は正しい
    it("回数の方が強い（古くても多く使った方が先）", () => {
        const photos = [
            P({ tags: ["よく使う"], createdAt: "2024-01-01T00:00:00Z" }),
            P({ tags: ["よく使う"], createdAt: "2024-01-02T00:00:00Z" }),
            P({ tags: ["一度だけ"], createdAt: "2026-09-01T00:00:00Z" }),
        ];
        expect(collectOwnValues(photos).tags).toEqual(["よく使う", "一度だけ"]);
    });

    // **文字順は最後の砦**（毎回同じ並びにするため）
    it("回数も時刻も同じなら文字順", () => {
        const photos = [
            P({ tags: ["い", "あ"], createdAt: "2026-09-01T00:00:00Z" }),
        ];
        expect(collectOwnValues(photos).tags).toEqual(["あ", "い"]);
    });

    // **撮影日を持つ写真は `date` で見る**（`photoOrder` の `photoTimeKey`
    // に合わせる。並びの規則をこのファイルで作り直さない）
    it("撮影日があれば投稿日より撮影日で見る", () => {
        const photos = [
            P({ tags: ["撮影が新しい"], date: "2026-09-01", createdAt: "2024-01-01T00:00:00Z" }),
            P({ tags: ["投稿が新しい"], date: "2020-01-01", createdAt: "2026-09-02T00:00:00Z" }),
        ];
        expect(collectOwnValues(photos).tags).toEqual(["撮影が新しい", "投稿が新しい"]);
    });

    // 時刻を持たない写真があっても落ちない（持つ方が先に来る）
    it("時刻が無い写真も混ぜられる", () => {
        const photos = [
            P({ tags: ["時刻なし"] }),
            P({ tags: ["時刻あり"], createdAt: "2026-09-01T00:00:00Z" }),
        ];
        expect(collectOwnValues(photos).tags).toEqual(["時刻あり", "時刻なし"]);
    });

    // **これが直したかったこと。** 文字順のままだと、上限で切ったときに
    // 日本語が落ちる
    it("上限で切るとき、文字順だけでは日本語が落ちる（新しい順なら残る）", () => {
        const latin = Array.from({ length: 30 }, (_, i) =>
            P({ tags: [`tag${String(i).padStart(2, "0")}`], createdAt: "2024-01-01T00:00:00Z" }));
        const jp = P({ tags: ["白鳥"], createdAt: "2026-09-01T00:00:00Z" });
        const tags = collectOwnValues([...latin, jp]).tags;
        expect(tags, "新しく使った日本語のタグが候補から落ちている").toContain("白鳥");
        expect(tags[0]).toBe("白鳥");
    });
});

// 変異で見つかった穴2つ（どちらも等価ではなく、見ていなかっただけ）
describe("タグの候補: 上限と、複数枚に付いたタグの時刻", () => {
    // **「最後に使った」は最大であって、最後に見た写真ではない。**
    // 一覧の並びは保証されていないので、上書きにすると
    // 「古い写真が後ろに来た回」だけ順位が下がる
    it("複数枚に付いたタグは、いちばん新しい写真の時刻で見る", () => {
        const photos = [
            P({ tags: ["旅"], createdAt: "2026-09-01T00:00:00Z" }),
            P({ tags: ["旅"], createdAt: "2024-01-01T00:00:00Z" }),  // 後ろに古いものが来る
            P({ tags: ["山"], createdAt: "2025-01-01T00:00:00Z" }),
            P({ tags: ["山"], createdAt: "2025-01-02T00:00:00Z" }),
        ];
        expect(collectOwnValues(photos).tags).toEqual(["旅", "山"]);
    });

    // 上限は撮影地では縛ってあったが、**タグでは見ていなかった**
    // （実データで上限に届くのはタグだけ＝ここが本番）
    it("タグも上限で切る", () => {
        const photos = Array.from({ length: 40 }, (_, i) => P({ tags: [`tag${i}`] }));
        expect(collectOwnValues(photos).tags).toHaveLength(30);
    });
});

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
        expect(hasTag(" , ,山", "山")).toBe(true);
    });
});

describe("toggleTag（押し直したら外れる）", () => {
    it("入っていなければ足す", () => {
        expect(toggleTag("自然, 山", "夜景")).toBe("自然, 山, 夜景");
        expect(toggleTag("", "山")).toBe("山");
    });

    it("入っていれば外す", () => {
        expect(toggleTag("自然, 山", "山"), "押しても何も起きない").toBe("自然");
        expect(toggleTag("山", "山")).toBe("");
    });

    // 外すときも畳んで見る（`fuji` の欄で候補の `Fuji` を押したら外れる）
    it("書き方が違っても、同じタグなら外れる", () => {
        expect(toggleTag("夜景, Fuji", "fuji")).toBe("夜景");
        expect(toggleTag("旅", "#旅")).toBe("");
        expect(toggleTag("風景, 山", "landscape")).toBe("山");
    });

    it("空のタグでは何もしない", () => {
        expect(toggleTag("自然", "  ")).toBe("自然");
    });

    // **足す側は `appendTag` に任せる**——何も変わらない回に元の文字列を
    // そのまま返す性質（空白の入れ方を勝手に直さない）を壊さない
    it("足す側の空白の扱いは変えない", () => {
        expect(toggleTag("自然,山", "海")).toBe("自然, 山, 海");
    });
});
