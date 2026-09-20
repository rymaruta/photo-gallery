import { describe, it, expect } from "vitest";
import { displayTitle } from "../photoTitle";

// owner:「タイトルに無題と入ってしまう。一覧を見たときに無題ではなくて、
// タイトルなくてもいいよ」。**「無題」は表示の落とし先ではなく、サーバーが
// 保存していた実データ**なので、保存をやめても既存の写真には残る。出す側でも落とす
describe("displayTitle", () => {
    it("サーバーが入れていた「無題」/ Untitled は題として扱わない", () => {
        expect(displayTitle("無題")).toBe("");
        expect(displayTitle("Untitled")).toBe("");
        expect(displayTitle("  無題  "), "前後の空白で素通りする").toBe("");
    });

    it("題が無いときは空", () => {
        expect(displayTitle(undefined)).toBe("");
        expect(displayTitle("")).toBe("");
        expect(displayTitle("   ")).toBe("");
    });

    it("本物の題はそのまま（前後の空白だけ落とす）", () => {
        expect(displayTitle("白波の夏")).toBe("白波の夏");
        expect(displayTitle("  リアス海岸 ")).toBe("リアス海岸");
        // **部分一致で落とさない**——「無題の風景」は利用者が名付けた題
        expect(displayTitle("無題の風景"), "本物の題を落としている").toBe("無題の風景");
        expect(displayTitle("Untitled Symphony")).toBe("Untitled Symphony");
    });
});
