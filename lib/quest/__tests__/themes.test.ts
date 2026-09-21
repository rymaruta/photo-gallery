import { describe, it, expect } from "vitest";
import {
    QUEST_THEMES,
    questDayNumber,
    isQuestDateKey,
    questThemeForDate,
    questTodayKey,
    isQuestJoinable,
    questRowId,
    QUEST_JOIN_WINDOW_DAYS,
} from "../themes";

describe("QUEST_THEMES（表そのもの）", () => {
    it("id が重複していない", () => {
        const ids = QUEST_THEMES.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
    it("id は URL に置ける形（英小文字とハイフン）", () => {
        for (const t of QUEST_THEMES) {
            expect(t.id, `${t.id} が英小文字とハイフン以外を含む`).toMatch(/^[a-z][a-z-]*[a-z]$/);
        }
    });
    it("題も一言も空でない", () => {
        for (const t of QUEST_THEMES) {
            expect(t.title.length, `${t.id} の題が空`).toBeGreaterThan(0);
            expect(t.hint.length, `${t.id} の一言が空`).toBeGreaterThan(0);
        }
    });
    it("競争を持ち込む語が混ざっていない（owner の明示の指示）", () => {
        // 連続記録・レベル・称号・ランキングは作らない。
        const banned = /連続|ランキング|レベル|称号|順位|ポイント|スコア/;
        for (const t of QUEST_THEMES) {
            expect(banned.test(t.title + t.hint), `${t.id} が競争の語を含む`).toBe(false);
        }
    });
});

describe("questDayNumber", () => {
    it("1970-01-01 が 0", () => {
        expect(questDayNumber("1970-01-01")).toBe(0);
    });
    it("翌日は +1", () => {
        expect(questDayNumber("1970-01-02")).toBe(1);
    });
    it("1970 より前は負", () => {
        expect(questDayNumber("1969-12-31")).toBe(-1);
    });
    it("うるう日を数えている", () => {
        const a = questDayNumber("2024-02-28")!;
        const b = questDayNumber("2024-03-01")!;
        expect(b - a).toBe(2); // 2/29 が間に在る
    });
    it.each([
        ["2026-9-21", "月が1桁"],
        ["2026-09-1", "日が1桁"],
        ["26-09-21", "年が2桁"],
        ["2026-09-21T00:00:00", "時刻付き"],
        ["2026-09-21Z", "ゾーン付き"],
        ["2026/09/21", "区切りが違う"],
        ["", "空"],
        ["今日", "日付ですらない"],
    ])("形が違う %s（%s）は null", (value) => {
        expect(questDayNumber(value)).toBeNull();
    });
    it.each(["2026-02-31", "2026-13-01", "2026-00-10", "2026-09-00", "2025-02-29"])(
        "存在しない日付 %s は null（Date.UTC の繰り上がりを通さない）",
        (value) => {
            expect(questDayNumber(value)).toBeNull();
        },
    );
});

describe("isQuestDateKey", () => {
    it("妥当な日付だけ true", () => {
        expect(isQuestDateKey("2026-09-21")).toBe(true);
        expect(isQuestDateKey("2026-02-31")).toBe(false);
    });
    it("文字列でない値でも落ちない", () => {
        expect(isQuestDateKey(undefined)).toBe(false);
        expect(isQuestDateKey(null)).toBe(false);
        expect(isQuestDateKey(20260921)).toBe(false);
        expect(isQuestDateKey({})).toBe(false);
        expect(isQuestDateKey(["2026-09-21"])).toBe(false);
    });
});

describe("questThemeForDate", () => {
    it("同じ日付はいつ呼んでも同じテーマ", () => {
        const a = questThemeForDate("2026-09-21");
        const b = questThemeForDate("2026-09-21");
        expect(a).not.toBeNull();
        expect(a).toEqual(b);
    });
    it("連続する日は表の順に進む", () => {
        const a = questThemeForDate("2026-09-21")!;
        const b = questThemeForDate("2026-09-22")!;
        const ia = QUEST_THEMES.findIndex((t) => t.id === a.id);
        const ib = QUEST_THEMES.findIndex((t) => t.id === b.id);
        expect(ib).toBe((ia + 1) % QUEST_THEMES.length);
    });
    it("表の長さだけ進むと一周して戻る", () => {
        const a = questThemeForDate("2026-09-21")!;
        const day = questDayNumber("2026-09-21")!;
        const later = new Date((day + QUEST_THEMES.length) * 86_400_000).toISOString().slice(0, 10);
        expect(questThemeForDate(later)!.id).toBe(a.id);
    });
    it("1970 より前でも表から外れない（負の剰余を畳んでいる）", () => {
        const t = questThemeForDate("1969-12-31");
        expect(t).not.toBeNull();
        expect(QUEST_THEMES.some((x) => x.id === t!.id)).toBe(true);
    });
    it("形が違う日付は null（適当な既定を返さない）", () => {
        expect(questThemeForDate("2026-13-01")).toBeNull();
        expect(questThemeForDate("きょう")).toBeNull();
    });
    it("表のどのテーマにもいつかは当たる", () => {
        const seen = new Set<string>();
        const start = questDayNumber("2026-01-01")!;
        for (let i = 0; i < QUEST_THEMES.length; i++) {
            const key = new Date((start + i) * 86_400_000).toISOString().slice(0, 10);
            seen.add(questThemeForDate(key)!.id);
        }
        expect(seen.size).toBe(QUEST_THEMES.length);
    });
});

describe("questTodayKey", () => {
    it("端末の暦で切る（UTC ではない）", () => {
        // JST(UTC+9) の 2026-09-21 06:00 は UTC ではまだ 09-20 21:00。
        // 端末の暦で切るので 09-21 でなければならない。
        const d = new Date(2026, 8, 21, 6, 0, 0); // ローカル時刻として組む
        expect(questTodayKey(d)).toBe("2026-09-21");
    });
    it("1桁の月日を0で埋める", () => {
        expect(questTodayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    });
    it("返す値がそのまま questDayNumber に通る", () => {
        expect(questDayNumber(questTodayKey(new Date(2026, 1, 29)))).not.toBeNull();
    });
    it("引数なしでも妥当な形を返す", () => {
        expect(isQuestDateKey(questTodayKey())).toBe(true);
    });
});

describe("isQuestJoinable", () => {
    it("同じ日は通る", () => {
        expect(isQuestJoinable("2026-09-21", "2026-09-21")).toBe(true);
    });
    it("前後1日は通る（端末の暦と UTC のずれを吸収する）", () => {
        expect(isQuestJoinable("2026-09-20", "2026-09-21")).toBe(true);
        expect(isQuestJoinable("2026-09-22", "2026-09-21")).toBe(true);
    });
    it("2日離れたら通さない", () => {
        expect(isQuestJoinable("2026-09-19", "2026-09-21")).toBe(false);
        expect(isQuestJoinable("2026-09-23", "2026-09-21")).toBe(false);
    });
    it("月をまたいでも日数で見ている", () => {
        expect(isQuestJoinable("2026-08-31", "2026-09-01")).toBe(true);
        expect(isQuestJoinable("2026-08-30", "2026-09-01")).toBe(false);
    });
    it("窓は前後1日（この値を広げるとテストが落ちる）", () => {
        expect(QUEST_JOIN_WINDOW_DAYS).toBe(1);
    });
    it("形が違う日付は通さない", () => {
        expect(isQuestJoinable("2026-13-01", "2026-09-21")).toBe(false);
        expect(isQuestJoinable("2026-09-21", "こわれた")).toBe(false);
    });
});

describe("questRowId", () => {
    it("日付ごとに1行", () => {
        expect(questRowId("2026-09-21")).toBe("quest#2026-09-21");
        expect(questRowId("2026-09-22")).not.toBe(questRowId("2026-09-21"));
    });
    it("他の一覧（following# / likes#）と衝突しない接頭辞", () => {
        expect(questRowId("2026-09-21").startsWith("quest#")).toBe(true);
    });
});
