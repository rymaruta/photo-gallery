import { describe, it, expect } from "vitest";
import { NO_TAP, isDoubleTap, doubleTapAction } from "../doubleTap";

// 一覧のモーダルと写真ページの全画面が共有する決まり（iOS の `DoubleTapLike` と同じ）
describe("isDoubleTap", () => {
    it("350ms 以内・40px 以内なら2回目", () => {
        expect(isDoubleTap({ t: 1000, x: 0, y: 0 }, { t: 1300, x: 20, y: 20 })).toBe(true);
    });
    it("間が空いた・離れた・最初の1回は2回目ではない", () => {
        expect(isDoubleTap({ t: 1000, x: 0, y: 0 }, { t: 1350, x: 0, y: 0 })).toBe(false);
        expect(isDoubleTap({ t: 1000, x: 0, y: 0 }, { t: 1100, x: 60, y: 0 })).toBe(false);
        expect(isDoubleTap(NO_TAP, { t: 100, x: 0, y: 0 })).toBe(false);
    });
});

describe("doubleTapAction", () => {
    it("拡大中は倍率を戻す（いいね済みかに関わらず）", () => {
        expect(doubleTapAction({ isZoomed: true, alreadyLiked: false })).toBe("resetZoom");
        expect(doubleTapAction({ isZoomed: true, alreadyLiked: true })).toBe("resetZoom");
    });
    it("いいね済みは消さない（演出だけ）", () => {
        expect(doubleTapAction({ isZoomed: false, alreadyLiked: true })).toBe("burstOnly");
        expect(doubleTapAction({ isZoomed: false, alreadyLiked: false })).toBe("like");
    });
});
