import { describe, it, expect } from "vitest";
import { spotSavedKey, parseSavedKey, isSpotKey, dedupeSavedKeys, SPOT_KEY_PREFIX } from "../savedSpotKey";
import { slugify } from "../collections";

/**
 * **「行きたい場所」に公式スポットを足しても、既存の保存を壊さない。**
 *
 * owner の指示書 第10章:
 *   - 既存の保存済み撮影地を削除しない
 *   - 旧形式と新形式を区別し、読み取り互換を設計する
 *   - 重複保存を防ぐ。**ただし対応関係が不明なものを勝手に同一視しない**
 */
describe("保存の鍵", () => {
    it("公式スポットには頭が付く", () => {
        expect(spotSavedKey("takaya-jinja")).toBe("SPOT-takaya-jinja");
        expect(isSpotKey("SPOT-takaya-jinja")).toBe(true);
    });

    /// 🔴 **これまでの保存は、頭が無い＝撮影地。** 読み方を変えない
    it("頭の無いものは、今までどおり撮影地として読む", () => {
        expect(parseSavedKey("パリ")).toEqual({ kind: "location", slug: "パリ" });
        expect(parseSavedKey("yamanakako")).toEqual({ kind: "location", slug: "yamanakako" });
        expect(isSpotKey("パリ")).toBe(false);
    });

    /// 🔴 **衝突しないことの根拠。**
    ///
    /// 撮影地のスラッグは `slugify` を通り、あれは `toLowerCase()` する。
    /// つまり**出力に大文字は現れない**ので、撮影地の名前が偶然
    /// `SPOT-…` になることは原理的に無い。
    ///
    /// ⚠️ 接頭辞は2回選び直している（`spot:` はコロンが落ちない／
    /// `spot/` はパスに乗らない）。**思い込みではなく、ここで実際に通す**
    it("撮影地のスラッグは、接頭辞の形にならない", () => {
        const probes = [
            "SPOT-takaya", "Spot-Takaya", "spot-takaya", "SPOT/takaya",
            "SPOT ABC", "SPOT-", "東京 / 渋谷", "パリ", "#旅", "ＳＰＯＴ-x",
        ];
        for (const raw of probes) {
            expect(slugify(raw, "location"), `${raw} が接頭辞の形になっている`)
                .not.toMatch(new RegExp(`^${SPOT_KEY_PREFIX}`));
        }
    });

    /// **判定の自己確認。** 小文字にした同じ形なら、この見張りは落ちる
    /// ——「どんな入力でも通る」空回りではないことを見る
    it("小文字の同じ形なら、この見張りは落ちる（空回りしていない）", () => {
        const lower = SPOT_KEY_PREFIX.toLowerCase();
        expect(slugify("SPOT-takaya", "location"), "slugify は小文字にする（前提の確認）")
            .toMatch(new RegExp(`^${lower}`));
    });

    /// 🔴 **接頭辞は URL のパス片にそのまま置けること。**
    ///
    /// 外す口は `DELETE /user/spots/{slug}` で、鍵がパスに乗る。
    /// `/` を使うと `%2F` になり、**API Gateway の扱いをこの環境からは
    /// 確かめられない**（当たらなければ「保存はできるが外せない」）。
    /// 記号を1つも使わないことで、その心配自体を消している
    it("接頭辞は、URL のパスでエンコードが要らない", () => {
        expect(encodeURIComponent(SPOT_KEY_PREFIX)).toBe(SPOT_KEY_PREFIX);
    });

    /// **サーバーが受ける形に収まる**（`isStoredSpotSlug`＝空でなく `#` を含まない）
    it("サーバーの受け付ける形に収まる", () => {
        const key = spotSavedKey("takaya-jinja");
        expect(key.length).toBeGreaterThan(0);
        expect(key).not.toContain("#");
    });

    /// **知らない形を捨てない。** 捨てると既存の保存が消えたように見える
    it("読めない形でも撮影地として残す", () => {
        expect(parseSavedKey("なにか変な値").kind).toBe("location");
    });

    /**
     * 🔴 **壊れた鍵でも落とさない。**
     *
     * 一度は「スラッグが空なら捨てる」にしていたが、**捨てると画面に出ない
     * のにサーバーには残り、本人が外す手段を失う**（レビューが指摘）。
     * 入る隙そのものは `publishBlockers` が塞いだ（`slug` が無ければ公開しない）
     * が、**既に入ったものを外せる道は残す**。
     *
     * 落とすのは空文字だけ——サーバーはそもそも受け付けない値。
     */
    it("スラッグの無いスポット鍵も残す（外せなくならないように）", () => {
        expect(dedupeSavedKeys([SPOT_KEY_PREFIX])).toEqual([SPOT_KEY_PREFIX]);
        expect(dedupeSavedKeys([SPOT_KEY_PREFIX, SPOT_KEY_PREFIX])).toEqual([SPOT_KEY_PREFIX]);
    });

    it("空文字は落とす（サーバーが受け付けない値）", () => {
        expect(dedupeSavedKeys(["", "  ", "パリ"])).toEqual(["パリ"]);
    });

    describe("重複の畳み方", () => {
        it("同じ種別・同じスラッグは1つに", () => {
            expect(dedupeSavedKeys(["SPOT-a", "SPOT-a", "パリ", "パリ"])).toEqual(["SPOT-a", "パリ"]);
        });

        /// 🔴 **綴りが同じでも、種別が違えば別物として残す。**
        /// 同じ場所かどうかを機械が決められない（owner の指示）
        it("`SPOT-takaya` と `takaya` は統合しない", () => {
            expect(dedupeSavedKeys(["SPOT-takaya", "takaya"])).toEqual(["SPOT-takaya", "takaya"]);
        });

        it("並びは保つ（新しい順のまま）", () => {
            expect(dedupeSavedKeys(["c", "SPOT-b", "a", "c"])).toEqual(["c", "SPOT-b", "a"]);
        });
    });
});
