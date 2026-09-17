import { describe, it, expect } from "vitest";
import { TAG_CHOICES } from "../tagChoices";
import { TAG_ALIASES, CATEGORY_ALIASES, slugify, tagKey } from "../collections";
import { CATEGORY_CHOICES } from "../categoryChoices";
import { hasTag, toggleTag, suggestTags } from "../ownValues";

/**
 * **決まった選択肢と別名表は1対1。**
 *
 * 「別名表を私が毎回直す形」は一度断られている（`木/tree/trees`・
 * `白鳥/swan`…と際限なく増えて静かに古くなるため）。ここが違うのは
 * **表の中身が選択肢そのもの**だからで、**両方向**を見張って初めて
 * 「勝手に増えない」と言える。
 */
describe("選択肢と別名表が食い違わない", () => {
    it("選択肢は全部、別名表に在る", () => {
        for (const t of TAG_CHOICES) {
            expect(TAG_ALIASES[t], `${t} が TAG_ALIASES に無い（/tag/${t} に割れる）`).toBeTruthy();
        }
    });

    it("別名表に、選択肢に無い語を足していない（静かに増えない）", () => {
        const choices = new Set(TAG_CHOICES);
        for (const k of Object.keys(TAG_ALIASES)) {
            expect(choices.has(k), `TAG_ALIASES の「${k}」が TAG_CHOICES に無い`).toBe(true);
        }
    });

    it("寄せ先が2つの語で重なっていない（別の主題が同じページになる）", () => {
        const slugs = Object.values(TAG_ALIASES);
        expect(slugs.filter((v, i) => slugs.indexOf(v) !== i)).toEqual([]);
    });
});

/**
 * **カテゴリとは別の軸。** 同じ語を両方に置くと、どちらに入れるかで人が迷い、
 * 同じ写真が2つの軸に散る。
 */
describe("カテゴリと軸が重ならない", () => {
    it("同じ語が両方の選択肢に無い", () => {
        const cat = new Set<string>(CATEGORY_CHOICES);
        for (const t of TAG_CHOICES) expect(cat.has(t), `${t} がカテゴリにも在る`).toBe(false);
    });

    it("2つの表が同じ鍵を取り合っていない（どちらが勝つかで結果が変わる）", () => {
        for (const k of Object.keys(TAG_ALIASES)) {
            expect(Object.hasOwn(CATEGORY_ALIASES, k), `${k} が両方の表に在る`).toBe(false);
        }
    });

    it("タグの別名はカテゴリには当てない（/category/winter を作らない）", () => {
        expect(slugify("冬", "tag")).toBe("winter");
        expect(slugify("冬", "category"), "カテゴリにまで当たっている").toBe("冬");
    });
});

/**
 * 🔴 **既に英語で保存されている写真と、同じページ・同じチップになること。**
 *
 * 実データ（公開30枚）は `winter` 12枚・`sunset` 2枚・`forest` 2枚…と
 * **英語で保存されている**。寄らないと (a) `/tag/冬` と `/tag/winter` に割れ、
 * (b) チップが「選択中」に光らず、押すと**同じ意味のタグが2つ**付く。
 */
describe("既に在る英語の綴りと同じものになる", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
        ["冬", "winter"], ["雪", "snow"], ["夜", "night"], ["夕焼け", "sunset"],
        ["海", "sea"], ["山", "mountain"], ["湖", "lake"], ["森", "forest"],
        ["花", "flowers"], ["桜", "cherry"], ["神社", "shrine"], ["公園", "park"],
    ];

    it("同じスラッグに寄る", () => {
        for (const [ja, en] of pairs) {
            expect(tagKey(ja), `${ja} と ${en} が別ページに割れる`).toBe(tagKey(en));
        }
    });

    it("英語で保存された欄でも、チップが選択中に光る", () => {
        for (const [ja, en] of pairs) {
            expect(hasTag(`${en}, finland`, ja), `${ja} のチップが光らない`).toBe(true);
        }
    });

    it("英語で入っているタグをチップで外せる（二重に足さない）", () => {
        expect(toggleTag("winter, finland", "冬")).not.toContain("冬");
        expect(toggleTag("winter, finland", "冬")).not.toContain("winter");
        // 入っていなければ足す（ふつうの向き）
        expect(toggleTag("finland", "冬")).toContain("冬");
    });
});

/**
 * **候補は全部出る。** 枠に入りきらず選んだチップが消えるのが、
 * 過去の候補（59種）でいちばん困っていたところだった。
 */
describe("候補の出し方", () => {
    const limit = TAG_CHOICES.length;

    it("何も打っていなければ、選択肢を宣言した順にそのまま全部出す", () => {
        expect(suggestTags(TAG_CHOICES, "", limit)).toEqual([...TAG_CHOICES]);
    });

    it("選んでもチップが動かない（押し間違えない）", () => {
        // 過去の候補では選んだものが先頭へ寄っていた。全部出るいまは寄せない
        expect(suggestTags(TAG_CHOICES, "夜, ", limit)).toEqual([...TAG_CHOICES]);
        expect(suggestTags(TAG_CHOICES, "winter, ", limit), "英語で入っていても動かない").toEqual([...TAG_CHOICES]);
    });

    it("打った文字で絞る", () => {
        expect(suggestTags(TAG_CHOICES, "夕", limit)).toEqual(["夕焼け"]);
        // 別名表を通って英語でも当たる（既に使っている綴りを思い出せる）
        expect(suggestTags(TAG_CHOICES, "win", limit)).toEqual(["冬"]);
    });

    it("地名や一回きりの語は候補に出ない（owner の指示）", () => {
        for (const w of ["finland", "helsinki", "yamanaka", "山中湖", "パリ", "igloo", "nemophila", "torii"]) {
            expect(suggestTags(TAG_CHOICES, w, limit), `${w} が候補に出ている`).toEqual([]);
        }
    });
});
