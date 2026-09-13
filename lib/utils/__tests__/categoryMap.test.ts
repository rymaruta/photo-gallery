import { describe, it, expect } from "vitest";
import { photoCategoryMap } from "../categoryMap";
import { ja } from "@/app/i18n/labels";

/**
 * **一覧のカテゴリ行が空欄になった回帰の再現。**
 *
 * 読む側（`app/components/GalleryGrid.tsx`）は
 * `categoryDisplayMap?.[photo.category ?? ""]` と**生の値**で引き、
 * **落とし先を持たない**ので、鍵が外れると文字が丸ごと消える。
 * 地図の鍵をスラッグに変えた回で、`/favorites` のカテゴリ行が
 * 実データ30枚中9枚（風景4・自然2・建築2・建物1）で空欄になった。
 * （`/favorites` を描くテストはリポジトリに1本も無く、
 *   フルスイート4,828件が緑のまま通った。）
 */
const names = (ja.category?.names ?? {}) as Record<string, string>;

describe("一覧のカテゴリ名の地図", () => {
    // **これが回帰そのもの。** 読む側と同じ引き方で必ず名前が出ること
    it("写真が持っている値そのもので引ける（空欄にならない）", () => {
        const photos = [
            { category: "風景" }, { category: "landscape" },
            { category: "建物" }, { category: "建築" }, { category: "architecture" },
            { category: "自然" }, { category: "travel" },
        ];
        const map = photoCategoryMap(photos, names);
        for (const p of photos) {
            expect(map[p.category], `${p.category} が空欄になる`).toBeTruthy();
        }
    });

    // 別名で保存された写真も、飛び先の集約ページと同じ言葉にする
    it("同じ集約ページへ行く値は、同じ名前になる", () => {
        const map = photoCategoryMap(
            [{ category: "建物" }, { category: "建築" }, { category: "architecture" }],
            names,
        );
        expect(map["建物"], "生の値がそのまま出ている").toBe("建築");
        expect(map["建築"]).toBe("建築");
        expect(map["architecture"]).toBe("建築");
    });

    it("表に無いカテゴリはスラッグを見出し語にする", () => {
        const map = photoCategoryMap([{ category: "travel" }, { category: "ご飯" }], names);
        expect(map["travel"]).toBe("Travel");
        expect(map["ご飯"]).toBe("ご飯");
    });

    it("カテゴリが無い・空の写真は鍵を作らない", () => {
        expect(photoCategoryMap([{}, { category: "   " }], names)).toEqual({});
    });

    // 先に見つけた方を残す（同じ鍵で上書きして無駄に作り直さない）
    it("同じカテゴリが何枚あっても鍵は1つ", () => {
        const map = photoCategoryMap([{ category: "風景" }, { category: "風景" }], names);
        expect(Object.keys(map)).toEqual(["風景"]);
    });
});
