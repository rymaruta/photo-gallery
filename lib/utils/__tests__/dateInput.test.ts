import { describe, it, expect } from "vitest";
import { toDateInputValue, mergeDate } from "../dateInput";

// 背景: <input type="date"> に ISO 文字列を渡すと黙って空欄になる。
// 空欄を「撮影日が未入力」と誤解して選び直すと、今度は時刻が落ちて
// 同じ日に撮った写真の並び順が崩れていた。読み・書きの両方を固定する。

describe("toDateInputValue", () => {
    it("ISO 文字列から日付部分だけを取り出す", () => {
        expect(toDateInputValue("2026-05-03T10:22:00.000Z")).toBe("2026-05-03");
    });

    it("すでに YYYY-MM-DD ならそのまま返す", () => {
        expect(toDateInputValue("2026-05-03")).toBe("2026-05-03");
    });

    it("未設定・空文字は空文字", () => {
        expect(toDateInputValue(undefined)).toBe("");
        expect(toDateInputValue("")).toBe("");
    });

    it("日付として読めない文字列は空文字（input を壊さない）", () => {
        expect(toDateInputValue("春の京都")).toBe("");
    });

    it("ISO 以外でも解釈できる形式は日付に変換する", () => {
        expect(toDateInputValue("May 3, 2026 00:00:00 UTC")).toBe("2026-05-03");
    });
});

describe("mergeDate", () => {
    it("同じ日を選び直しても元の時刻を保つ", () => {
        expect(mergeDate("2026-05-03T10:22:00.000Z", "2026-05-03"))
            .toBe("2026-05-03T10:22:00.000Z");
    });

    it("別の日に変えたら入力値をそのまま使う", () => {
        expect(mergeDate("2026-05-03T10:22:00.000Z", "2026-05-04")).toBe("2026-05-04");
    });

    it("元の値が無ければ入力値をそのまま使う", () => {
        expect(mergeDate(undefined, "2026-05-04")).toBe("2026-05-04");
    });

    it("元の値が壊れていても入力値を優先する", () => {
        expect(mergeDate("不明", "2026-05-04")).toBe("2026-05-04");
    });

    it("空入力は空のまま（撮影日を消す操作を潰さない）", () => {
        expect(mergeDate("2026-05-03T10:22:00.000Z", "")).toBe("");
    });
});
