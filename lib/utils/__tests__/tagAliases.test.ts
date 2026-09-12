import { describe, it, expect } from "vitest";
import { collectEntries, photosInCollection, isIndexableCollection, legacyTagSlugs, canonicalCollectionPath, labelForSlug } from "../collections";
import { collectOwnValues } from "../ownValues";
import type { Photo } from "../../data/photos";

/**
 * **タグの日英を寄せる。**
 *
 * 実データで測ると、同じ主題が**別々の写真に別の言語で**付いていた:
 *
 *     風景 3枚 / landscape 1枚      ご飯 1枚 / restaurant 3枚
 *     自然 2枚 / nature 3枚         建物 1枚 / architecture 2枚
 *
 * どちらも 3枚（`MIN_INDEXABLE_COUNT`）に届かず**両方 noindex**。
 * 62ページ中55が検索に出ていない状態の、いちばん直せる部分。
 */
const P = (over: Partial<Photo>): Photo =>
    ({ id: Math.random().toString(36).slice(2), src: "https://cdn/x.jpg", ...over } as Photo);

// 実データの割れ方をそのまま写した（同じ写真に両方付いているのではなく、別々の写真）
const photos: Photo[] = [
    P({ id: "j1", tags: ["風景"] }), P({ id: "j2", tags: ["風景"] }), P({ id: "j3", tags: ["風景"] }),
    P({ id: "e1", tags: ["landscape"] }),
    P({ id: "b1", tags: ["建物"] }), P({ id: "b2", tags: ["architecture"] }), P({ id: "b3", tags: ["architecture"] }),
    P({ id: "x1", tags: ["高屋神社"] }),
];

describe("タグの日英を1ページに寄せる", () => {
    it("風景 と landscape が同じページになる", () => {
        const ids = photosInCollection(photos, "tag", "landscape").map((p) => p.id).sort();
        expect(ids, "日英が別ページのまま").toEqual(["e1", "j1", "j2", "j3"]);
    });

    it("旧URL（/tag/風景）でも同じ写真が出る", () => {
        const ids = photosInCollection(photos, "tag", "風景").map((p) => p.id).sort();
        expect(ids).toEqual(["e1", "j1", "j2", "j3"]);
    });

    // **これが目的。** 寄せる前はどちらも3枚未満で両方 noindex だった
    it("寄せた結果、検索に出せる枚数になる", () => {
        const entries = collectEntries(photos, "tag");
        const arch = entries.find((e) => e.slug === "architecture");
        expect(arch?.count, "建物1枚 + architecture2枚 が寄っていない").toBe(3);
        expect(isIndexableCollection(arch!.count, "tag"), "3枚あるのに noindex のまま").toBe(true);
        // 寄せる前の姿（別ページ）が残っていないこと
        expect(entries.map((e) => e.slug)).not.toContain("建物");
        expect(entries.map((e) => e.slug)).not.toContain("風景");
    });

    // **固有名詞は寄せない。** 表に無い語はそのまま＝長い語で1位を狙う側
    it("固有名詞のタグはそのまま残る", () => {
        expect(collectEntries(photos, "tag").map((e) => e.slug)).toContain("高屋神社");
    });

    // **旧URLを404にしない。** 静的エクスポートにはリダイレクトの層が無い
    it("統合前の名前もページとして残す", () => {
        const legacy = legacyTagSlugs(photos);
        expect(legacy, "/tag/風景 がハード404になる").toContain("風景");
        expect(legacy).toContain("建物");
        // 統合の必要がない語は「旧URL」ではない（無駄なページを作らない）
        expect(legacy).not.toContain("高屋神社");
        expect(legacy).not.toContain("landscape");
    });

    // **評価は統合後へ寄せる。** 旧URLが別ページとして競合しない
    it("旧URLの canonical は統合後を指す", () => {
        expect(canonicalCollectionPath("tag", "風景")).toBe(canonicalCollectionPath("tag", "landscape"));
    });

    // **`#` の付いたタグからも旧URLを作る。** `slugify("#風景","tag")` は
    // `landscape` を返す＝統合前は `/tag/風景` で公開されていた。
    // 旧URLを作る側だけ手書きの正規化にしていて、この形が漏れていた
    it("記号つきのタグでも旧URLを残す", () => {
        const legacy = legacyTagSlugs([P({ id: "h", tags: ["#風景"] })]);
        expect(photosInCollection([P({ id: "h", tags: ["#風景"] })], "tag", "landscape"), "そもそも寄っていない").toHaveLength(1);
        expect(legacy, "/tag/風景 がハード404になる").toContain("風景");
    });

    // **見出しは「最初に当たった写真の生表記」で決めない。**
    // `photos.json` は `createdAt` 降順なので、英語表記の写真を1枚足すだけで
    // インデックス済みページの H1 が変わってしまう
    it("見出しは並び順で変わらない（最多の生表記を採る）", () => {
        const fwd = labelForSlug(photos, "tag", "architecture");
        const rev = labelForSlug([...photos].reverse(), "tag", "architecture");
        expect(fwd, "並び順で見出しが変わる").toBe(rev);
        expect(fwd, "最多の生表記になっていない").toBe("architecture");
        expect(labelForSlug(photos, "tag", "landscape")).toBe("風景");
    });

    // 同数なら文字順で決める（どちらでもよい場面でも順序に依らせない）。
    // **向きまで見る**——`fwd === rev` だけだと比較を逆向きにしても緑
    it("同数なら文字順で決める", () => {
        const tie = [P({ id: "t1", tags: ["建物"] }), P({ id: "t2", tags: ["architecture"] })];
        expect(labelForSlug(tie, "tag", "architecture")).toBe(
            labelForSlug([...tie].reverse(), "tag", "architecture"));
        // "architecture" < "建物"（ASCII が先）
        expect(labelForSlug(tie, "tag", "architecture"), "文字順が逆向き").toBe("architecture");
    });

    // **一覧のチップと、飛んだ先の見出しは同じ字でなければならない。**
    // 規則を `labelForSlug` にだけ入れて `collectEntries` を置いてきたとき、
    // 実データで チップ「#自然」→ 見出し「#nature の写真（4枚）」、
    // チップ「#建物」→「#architecture の写真（3枚）」と食い違っていた
    it("チップの字と、飛んだ先の見出しが一致する", () => {
        // 1枚の写真が「自然」と「nature」の両方を持つ実データの形を写す
        // （同じ写真内なので件数は1。票は畳む前に数えるので2表記とも入る）
        const mixed = [
            P({ id: "m1", tags: ["自然", "nature"] }),
            P({ id: "m2", tags: ["nature"] }),
            P({ id: "m3", tags: ["建物"] }), P({ id: "m4", tags: ["architecture"] }), P({ id: "m5", tags: ["architecture"] }),
        ];
        for (const e of collectEntries(mixed, "tag")) {
            expect(e.label, `チップ「${e.label}」と見出しが違う（${e.slug}）`)
                .toBe(labelForSlug(mixed, "tag", e.slug));
        }
        const nature = collectEntries(mixed, "tag").find((e) => e.slug === "nature");
        expect(nature?.label, "先頭一致のまま（並び順で字が変わる）").toBe("nature");
    });

    // **チップの字も並び順に依らない**（`collectEntries` 側の回帰よけ）
    it("チップの字は写真の並び順で変わらない", () => {
        const fwd = collectEntries(photos, "tag").find((e) => e.slug === "architecture")?.label;
        const rev = collectEntries([...photos].reverse(), "tag").find((e) => e.slug === "architecture")?.label;
        expect(fwd, "並び順でチップの字が変わる").toBe(rev);
        expect(fwd).toBe("architecture");
    });

    // 非公開の写真の表記に票を持たせない（並ぶ写真のどれにも無い字が
    // 見出しになる。`collectEntries` と `photosInCollection` は公開だけ見る）
    it("非公開の表記は見出しの票にしない", () => {
        const withHidden = [
            P({ id: "v1", tags: ["architecture"] }),
            P({ id: "h1", tags: ["建物"], published: false }),
            P({ id: "h2", tags: ["建物"], published: false }),
        ];
        expect(labelForSlug(withHidden, "tag", "architecture"), "非公開の表記が見出しになっている").toBe("architecture");
    });

    // **入力画面の候補も1つにまとまる。** ここが割れていると、
    // 次に入力する人がまた揺れを作る（＝寄せても増え続ける）
    it("入力候補のチップが日英で二重に出ない", () => {
        const tags = collectOwnValues(photos).tags;
        const both = tags.filter((t) => t === "風景" || t === "landscape");
        expect(both.length, "同じ主題のチップが2つ並んでいる").toBe(1);
        expect(tags).toContain("高屋神社");
    });
});
