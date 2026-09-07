import { describe, it, expect } from "vitest";
import { toDateInputValue, mergeDate, todayForDateInput } from "../dateInput";

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

    // 「UTC 0時ちょうど」は旧 sanitizeDate が日付だけの入力に付けていた
    // 捏造の時刻（C-12）。元の値を返し続けると、日付を変えない再保存で
    // 永久に移行されない（7951e8c レビューの指摘）。日付だけに直して返す。
    it("元が 0時ちょうど（旧仕様の捏造）なら、同じ日の保存で日付だけに直す", () => {
        expect(mergeDate("2026-01-20T00:00:00.000Z", "2026-01-20")).toBe("2026-01-20");
    });

    it("0時0分1秒は本物の時刻として保つ（直すのは 0時ちょうどだけ）", () => {
        expect(mergeDate("2026-01-20T00:00:01.000Z", "2026-01-20")).toBe("2026-01-20T00:00:01.000Z");
    });
});

// 入力欄に出す範囲。サーバー（両パッケージの sanitizeDate）が 1990年より前と
// 未来を断るので、入れる前に気づけるようにする
describe("todayForDateInput", () => {
    it("YYYY-MM-DD の形で、端末の暦の今日を返す", () => {
        expect(todayForDateInput(new Date(2026, 8, 7))).toBe("2026-09-07");
        // 1桁の月日を0埋めする（`2026-9-7` は input が黙って無視する）
        expect(todayForDateInput(new Date(2026, 0, 3))).toBe("2026-01-03");
    });

    it("UTC ではなく端末の暦で決める（時差で1日ずれない）", () => {
        // ローカル 2026-09-07 00:30 は UTC ではまだ 9/6 のこともある。
        // 画面が出す上限は端末の「今日」でよい——サーバーは24時間の余裕を持つ
        const d = new Date(2026, 8, 7, 0, 30);
        expect(todayForDateInput(d)).toBe("2026-09-07");
    });
});
