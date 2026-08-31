import { describe, it, expect } from "vitest";
import { getLocalized } from "@/lib/data/photos";
import { mergeLocalizedTitle, mergeLocalizedDescription } from "../page";
import { toDateInputValue, mergeDate } from "../../../../lib/utils/dateInput";

// 編集画面は日本語と日付だけを扱うが、保存は全項目の置換になる。
// 画面に出していない値（英語のタイトル・説明、撮影日の時刻）を
// 落とさないことを保証する。落とすと復旧できない。

describe("toDateInputValue", () => {
    it("ISO 文字列を YYYY-MM-DD にする（そのままだと入力欄が空になる）", () => {
        expect(toDateInputValue("2024-05-01T10:00:00.000Z")).toBe("2024-05-01");
    });
    it("既に YYYY-MM-DD ならそのまま", () => {
        expect(toDateInputValue("2024-05-01")).toBe("2024-05-01");
    });
    it("未設定・不正値は空", () => {
        expect(toDateInputValue(undefined)).toBe("");
        expect(toDateInputValue("なんでもない")).toBe("");
    });
});

describe("mergeDate", () => {
    it("日付を変えていなければ元の時刻を保つ", () => {
        expect(mergeDate("2024-05-01T10:00:00.000Z", "2024-05-01")).toBe("2024-05-01T10:00:00.000Z");
    });
    it("日付を変えたら入力値を使う", () => {
        expect(mergeDate("2024-05-01T10:00:00.000Z", "2024-06-02")).toBe("2024-06-02");
    });
    it("元が無ければ入力値をそのまま", () => {
        expect(mergeDate(undefined, "2024-06-02")).toBe("2024-06-02");
    });
    it("空にしたら空", () => {
        expect(mergeDate("2024-05-01T10:00:00.000Z", "")).toBe("");
    });
    // lib/utils/__tests__/dateInput.test.ts と同じ関数の複製スイート。
    // 新しいケースを片方だけに足すと乖離するので、移行の検証はここにも置く
    it("元が 0時ちょうど（旧仕様の捏造）なら日付だけに直す（C-12 の移行）", () => {
        expect(mergeDate("2024-05-01T00:00:00.000Z", "2024-05-01")).toBe("2024-05-01");
        expect(mergeDate("2024-05-01T00:00:01.000Z", "2024-05-01")).toBe("2024-05-01T00:00:01.000Z");
    });
});

describe("mergeLocalizedTitle", () => {
    it("英語があれば残したまま日本語を差し替える", () => {
        expect(mergeLocalizedTitle({ ja: "旧", en: "Old" }, "新")).toEqual({ ja: "新", en: "Old" });
    });
    it("英語が無ければ文字列のままでよい", () => {
        expect(mergeLocalizedTitle({ ja: "旧" }, "新")).toBe("新");
        expect(mergeLocalizedTitle("旧", "新")).toBe("新");
        expect(mergeLocalizedTitle(undefined, "新")).toBe("新");
    });

    // **空にしたら英語ごと消す。** 残していた頃は `{en:"Morning Sea"}` が
    // 保存され、日本語UIの表示は `getLocalized` のフォールバックで
    // **英語が出た**（消したつもりの説明が英訳のまま出続ける）。
    // 英語を編集・削除する画面はどこにも無いので、直す手段も無かった。
    it("日本語を空にしたら、英語ごと消える", () => {
        expect(mergeLocalizedTitle({ ja: "海の朝", en: "Morning Sea" }, ""),
            "英語が残って、消したはずの文字が英語で出る").toBe("");
        expect(mergeLocalizedTitle("海の朝", "")).toBe("");
    });

    it("説明も同じ（空行だけにしても消える）", () => {
        expect(mergeLocalizedDescription({ ja: ["旧1"], en: ["Old1", "Old2"] }, ""),
            "英語の段落が残っている").toBe("");
        expect(mergeLocalizedDescription({ ja: ["旧1"], en: ["Old1"] }, "\n  \n")).toBe("");
    });

    // 消した値がフォールバックで別言語に化けないこと（この修正の目的）
    it("消したあとは、日本語UIでも何も出ない", () => {
        const cleared = mergeLocalizedTitle({ ja: "海の朝", en: "Morning Sea" }, "");
        expect(getLocalized(cleared as string, "ja")).toBe("");
    });
});

describe("mergeLocalizedDescription", () => {
    it("英語の段落を残したまま日本語を差し替える", () => {
        const merged = mergeLocalizedDescription({ ja: ["旧1"], en: ["Old1", "Old2"] }, "新1\n新2");
        expect(merged).toEqual({ ja: ["新1", "新2"], en: ["Old1", "Old2"] });
    });
    it("英語が無ければ文字列のままでよい", () => {
        expect(mergeLocalizedDescription({ ja: ["旧"] }, "新")).toBe("新");
        expect(mergeLocalizedDescription(undefined, "新")).toBe("新");
    });
});
