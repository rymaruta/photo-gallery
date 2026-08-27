import { describe, it, expect } from "vitest";
import { collectOwnValues, appendTag } from "../ownValues";
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
