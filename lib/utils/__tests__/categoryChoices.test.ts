import { describe, it, expect } from "vitest";
import { CATEGORY_CHOICES, isChosenCategory, toggleCategory } from "../categoryChoices";
import { CATEGORY_ALIASES, slugify, categoryDisplayName, collectEntries } from "../collections";
import PHOTOS from "@/app/data/photos.json";
import type { Photo } from "@/lib/data/photos";

/**
 * **カテゴリを「打つ」から「選ぶ」へ**（owner の「風景、建築、人物、動物など
 * 狭めた選択肢にしたい」）。
 *
 * 自由入力は残してある（owner の判断）ので、ここで見るのは
 * **選択肢そのものの健全さ**——語彙が保存されている値と噛み合い、
 * 押した結果が既存のデータと同じ形に落ちること。
 */

const published = (PHOTOS as unknown as Photo[]).filter(
    (p) => p.published !== false && !(p as { story?: boolean }).story,
);

describe("カテゴリの選択肢", () => {
    it("owner が名指しした語を持っている", () => {
        for (const c of ["風景", "建築", "人物", "動物"]) {
            expect(CATEGORY_CHOICES, c).toContain(c);
        }
    });

    /**
     * ⚠️ **選択肢に足した語は別名表にも要る。** 足さないと日本語のまま
     * スラッグになり（`/category/動物`）、別の綴りで書かれた同じものと
     * **別ページに割れる**——実際 owner のデータには「ご飯」1枚があり、
     * 選択肢の「食べ物」を押すと2ページになるところだった。
     */
    it("選択肢は全部、別名表で英語スラッグに寄る", () => {
        for (const c of CATEGORY_CHOICES) {
            expect(CATEGORY_ALIASES[c], `${c} が CATEGORY_ALIASES に無い`).toBeTruthy();
            expect(slugify(c, "category"), `${c} が日本語のままスラッグになっている`).toMatch(/^[a-z]+$/);
        }
    });

    // 集約ページの見出し・写真ページのチップに出る名前が、押した語と一致すること
    // （寄せた先の代表表記が別の語だと「建物を押したのに建築と出る」になる）
    it("押した語が、そのまま画面に出る名前になる", () => {
        for (const c of CATEGORY_CHOICES) {
            expect(categoryDisplayName(slugify(c, "category")), c).toBe(c);
        }
    });

    it("同じスラッグに落ちる選択肢が2つ無い（押し分けられない語を並べない）", () => {
        const slugs = CATEGORY_CHOICES.map((c) => slugify(c, "category"));
        expect(new Set(slugs).size, `重複: ${slugs.join(",")}`).toBe(slugs.length);
    });

    /**
     * **実データのカテゴリを覆っていること。** 覆っていない値があると、
     * その写真を編集したときに「どのチップも光っていない」——本人は
     * カテゴリを付けたつもりなのに、選び直しを迫られる。
     */
    it("いま保存されているカテゴリは、全部どれかのチップになる", () => {
        const uncovered = new Set<string>();
        for (const p of published) {
            const raw = typeof p.category === "string" ? p.category.trim() : "";
            if (!raw) continue;
            if (!CATEGORY_CHOICES.some((c) => isChosenCategory(raw, c))) uncovered.add(raw);
        }
        expect([...uncovered], `選択肢に無いカテゴリ: ${[...uncovered].join(", ")}`).toEqual([]);
    });

    // 集約ページの数を変えていないこと（別名を足したのは割れを防ぐためで、
    // ページを増やす/減らす目的ではない）
    it("カテゴリの集約ページの数は変わらない（実データで6）", () => {
        expect(collectEntries(published, "category")).toHaveLength(6);
    });

    it("媒体の名前（写真・イラスト・デザイン）は選択肢に入れない", () => {
        for (const c of ["写真", "イラスト", "デザイン"]) {
            expect(CATEGORY_CHOICES, c).not.toContain(c);
        }
    });
});

describe("チップが光るかどうか（isChosenCategory）", () => {
    it("同じ綴りなら光る", () => {
        expect(isChosenCategory("風景", "風景")).toBe(true);
    });

    /**
     * 🔴 **綴りではなくスラッグで見る。** 実データは英語で保存された写真が
     * 多く（`landscape` 12枚・`風景` 4枚）、綴りで比べると
     * **16枚中12枚のチップが光らない**。光らないまま押すと日本語で保存し直され、
     * 割れ方が増える（このチップの目的と逆）。
     */
    it("英語で保存された値でも光る（実データの多数派）", () => {
        expect(isChosenCategory("landscape", "風景"), "英語で保存された写真のチップが光らない").toBe(true);
        expect(isChosenCategory("nature", "自然")).toBe(true);
        expect(isChosenCategory("architecture", "建築")).toBe(true);
    });

    it("別名で保存された値でも光る（建物 → 建築）", () => {
        expect(isChosenCategory("建物", "建築")).toBe(true);
    });

    it("大文字・前後の空白でも光る", () => {
        expect(isChosenCategory("  Landscape ", "風景")).toBe(true);
    });

    it("違うカテゴリでは光らない", () => {
        expect(isChosenCategory("風景", "建築")).toBe(false);
        expect(isChosenCategory("夜景", "風景")).toBe(false);
    });

    it("空・記号だけの値はどのチップも光らせない", () => {
        for (const raw of ["", "   ", "-", "###"]) {
            for (const c of CATEGORY_CHOICES) {
                expect(isChosenCategory(raw, c), `${JSON.stringify(raw)} / ${c}`).toBe(false);
            }
        }
    });

    /**
     * 🔴 **空スラッグ同士を「一致」と読まない。**
     *
     * `slugify` は `-` `#` `...` を**空文字**にするので、素朴に比べると
     * 「スラッグが空になる値」同士が全部一致する——このリポジトリは
     * 一度これで**検索語が空スラッグだと全件一致**する穴を作っている
     * （`3a0e3ce`）。
     *
     * **いまの選択肢では踏めない**（7語とも英字のスラッグを持つ）。
     * だが `isChosenCategory` は export されていて、上の一覧を通らない
     * 呼び方ができる。**守りを外すと素通りする**ことが変異で分かったので、
     * 一覧を経由せずに直接見る。
     */
    it("スラッグが空になる語どうしを一致と読まない（一覧を経由しない）", () => {
        expect(slugify("###", "category"), "前提が崩れている（空スラッグでない）").toBe("");
        expect(isChosenCategory("###", "###"), "空スラッグ同士が一致している").toBe(false);
        expect(isChosenCategory("", ""), "空同士が一致している").toBe(false);
        expect(isChosenCategory("  ", "-")).toBe(false);
    });
});

describe("チップを押したあと（toggleCategory）", () => {
    it("選んでいなければ、その語になる", () => {
        expect(toggleCategory("", "風景")).toBe("風景");
    });

    it("別のカテゴリなら置き換わる（カテゴリは1つしか持てない）", () => {
        expect(toggleCategory("建築", "風景")).toBe("風景");
    });

    // **押し直すと外れる**（タグのチップと同じ約束）。外す道が無いと、
    // 一度付けたカテゴリを消すのに入力欄を手で空にすることになる
    it("押し直すと外れる", () => {
        expect(toggleCategory("風景", "風景")).toBe("");
    });

    it("英語で保存されていても、同じチップを押せば外れる", () => {
        expect(toggleCategory("landscape", "風景"), "光っているのに押しても外れない").toBe("");
    });

    // 押した結果は必ず選択肢そのもの（表記ゆれを作らない）
    it("押した結果は選択肢の綴りそのもの", () => {
        for (const c of CATEGORY_CHOICES) {
            expect(toggleCategory("夜景", c)).toBe(c);
        }
    });
});
