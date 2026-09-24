import { describe, it, expect } from "vitest";
import { tallyBuckets, bucketLabel, decodeDataUri } from "../audit";

/**
 * 色タグの監査の道具。**決めないこと**が設計の肝なので、そこを縛る。
 */
describe("画素をバケツごとに数える", () => {
    /** 同じ色を n 画素ぶん並べる */
    const fill = (n: number, rgb: [number, number, number]) => Array.from({ length: n }, () => rgb).flat();

    it("面積の割合を返す（多い順）", () => {
        const px = [...fill(3, [20, 60, 200]), ...fill(1, [200, 40, 40])];
        const out = tallyBuckets(px, false);
        expect(out[0]).toEqual({ id: "blue", ratio: 0.75 });
        expect(out[1]).toEqual({ id: "red", ratio: 0.25 });
    });

    /**
     * 🔴 **彩度で絞ると、背景の暗色が消えて主題が出る。**
     *
     * これが owner の報告（「写真の色と違うタグ」）の核心——`dominantColor` は
     * いちばん多い1ビン＝たいてい影なので、面積で見ると影が勝つ。
     */
    it("無彩色を外すと、主題の色が上に来る", () => {
        // 影（ほぼ無彩色）が8割・緑が2割
        const px = [...fill(8, [30, 32, 31]), ...fill(2, [40, 160, 60])];
        expect(tallyBuckets(px, false)[0].id, "面積では影が勝つ").toBe("black");
        expect(tallyBuckets(px, true), "彩度で絞ると緑だけが残る").toEqual([{ id: "green", ratio: 1 }]);
    });

    it("彩度で絞って1画素も残らなければ空を返す（0件を色に化けさせない）", () => {
        expect(tallyBuckets(fill(5, [30, 32, 31]), true)).toEqual([]);
    });

    it("画素が無ければ空", () => {
        expect(tallyBuckets([], false)).toEqual([]);
        expect(tallyBuckets([], true)).toEqual([]);
    });

    /// 端の欠けた並び（3で割り切れない）を読み過ぎない
    it("3で割り切れない末尾は読まない", () => {
        expect(tallyBuckets([20, 60, 200, 99, 99], false)).toEqual([{ id: "blue", ratio: 1 }]);
    });

    /// **並びが実行のたびに変わらない**（同数のときの決着）
    it("同数なら `COLOR_BUCKETS` の順で決める", () => {
        const a = tallyBuckets([...fill(1, [20, 60, 200]), ...fill(1, [200, 40, 40])], false);
        const b = tallyBuckets([...fill(1, [200, 40, 40]), ...fill(1, [20, 60, 200])], false);
        expect(a.map((x) => x.id), "青が先（COLOR_BUCKETS の順）").toEqual(["blue", "red"]);
        expect(b.map((x) => x.id)).toEqual(a.map((x) => x.id));
    });

    it("上位3つまでしか返さない（読む人が比べられる数に留める）", () => {
        const px = [
            ...fill(5, [20, 60, 200]), ...fill(4, [200, 40, 40]), ...fill(3, [40, 160, 60]),
            ...fill(2, [240, 200, 40]), ...fill(1, [160, 60, 200]),
        ];
        expect(tallyBuckets(px, false)).toHaveLength(3);
    });
});

describe("名前とぼかしの復号", () => {
    it("バケツの id を画面の名前にする", () => {
        expect(bucketLabel("blue")).toBe("青");
        expect(bucketLabel("mono")).toBe("モノクロ");
    });

    /// 知らない id・`null` は**こちらで言葉を作らない**
    it("知らない id は空", () => {
        expect(bucketLabel("teal")).toBe("");
        expect(bucketLabel(null)).toBe("");
    });

    it("data URI から中身を取り出す", () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        expect(decodeDataUri(`data:image/png;base64,${png.toString("base64")}`)).toEqual(png);
    });

    /// **形が違えば推測で復号しない**
    it.each([
        ["空", ""],
        ["http の URL", "https://example.test/a.png"],
        ["base64 でない", "data:image/png;base64,###"],
        ["中身が空", "data:image/png;base64,"],
        ["画像でない", "data:text/plain;base64,YQ=="],
    ])("%s は null", (_name, uri) => {
        expect(decodeDataUri(uri)).toBeNull();
    });
});
