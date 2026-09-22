import { describe, it, expect } from "vitest";
import { swipeDirection, verticalSwipeDirection, stepInList } from "../swipe";

describe("swipeDirection", () => {
    it("左へ十分動いたら 1（次へ）", () => {
        expect(swipeDirection(-80, 5)).toBe(1);
    });
    it("右へ十分動いたら -1（前へ）", () => {
        expect(swipeDirection(80, -5)).toBe(-1);
    });
    it("移動が閾値未満なら 0（タップ等は無視）", () => {
        expect(swipeDirection(20, 0)).toBe(0);
        expect(swipeDirection(-10, 2)).toBe(0);
    });
    it("縦方向が優位なら 0（縦スクロールを奪わない）", () => {
        expect(swipeDirection(50, 200)).toBe(0);
        expect(swipeDirection(-50, -120)).toBe(0);
    });
    it("横が縦を明確に上回れば方向を返す（dx<0 は 1、dx>0 は -1）", () => {
        expect(swipeDirection(-120, 40)).toBe(1);
        expect(swipeDirection(120, 40)).toBe(-1);
    });
    it("横と縦が拮抗（ratio 以内）なら 0", () => {
        // |dx|=60, |dy|*1.4=70 → 60<=70 なので無視
        expect(swipeDirection(60, 50)).toBe(0);
    });
});

describe("stepInList", () => {
    const list = ["posts", "map", "timeline"] as const;
    it("次へ進む", () => {
        expect(stepInList(list, "posts", 1)).toBe("map");
        expect(stepInList(list, "map", 1)).toBe("timeline");
    });
    it("前へ戻る", () => {
        expect(stepInList(list, "timeline", -1)).toBe("map");
        expect(stepInList(list, "map", -1)).toBe("posts");
    });
    it("両端はクランプ（ラップしない）", () => {
        expect(stepInList(list, "posts", -1)).toBe("posts");
        expect(stepInList(list, "timeline", 1)).toBe("timeline");
    });
    it("リストに無い要素はそのまま", () => {
        expect(stepInList(list, "unknown" as unknown as (typeof list)[number], 1)).toBe("unknown");
    });
});

describe("verticalSwipeDirection", () => {
    // ストーリー閲覧のモック⑤: 上下でメニュー・閉じる、左右で前後
    it("下へ大きく動かせば 1（閉じる）", () => {
        expect(verticalSwipeDirection(0, 90)).toBe(1);
    });
    it("上へ大きく動かせば -1（メニュー）", () => {
        expect(verticalSwipeDirection(0, -90)).toBe(-1);
    });
    it("小さい動きは 0", () => {
        expect(verticalSwipeDirection(0, 60)).toBe(0);
        expect(verticalSwipeDirection(0, -60)).toBe(0);
    });
    // 斜めに払ったときに前後の送りと取り合わない
    it("横優位なら 0", () => {
        expect(verticalSwipeDirection(200, 90)).toBe(0);
        expect(swipeDirection(200, 90), "横はこちらが拾う（右へ＝前へ）").toBe(-1);
    });
    // **閉じるのは戻れない操作**なので、横（45px）より遠くまで払わせる
    it("しきい値は横より大きい", () => {
        expect(verticalSwipeDirection(0, 50)).toBe(0);
        expect(swipeDirection(50, 0)).toBe(-1);
    });
});
